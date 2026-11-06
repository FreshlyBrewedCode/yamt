import {
  addDays,
  CORE_NUTRIENTS,
  type CreatePlanningRequestBody,
  dayProgress,
  MAX_PLAN_DAYS,
  type MealSlot,
  MealSlot as MealSlotEnum,
  type NutrientTotals,
  type PickSuggestionBody,
  type PickSuggestionResponse,
  PLANNING_DEFAULTS,
  type PlanDay,
  type PlanningFilters,
  type PlanningInputJsonBody,
  type PlanningInputResponse,
  type PlanningOrigin,
  type PlanningRequest,
  type PlanningRequestDetail,
  type PlanningRequestsResponse,
  type PlanningRound,
  type PlanningRoundKind,
  type PlanningSuggestion,
  type PlanningSuggestionView,
  type PlanningUploadFields,
  portionItems,
  type Recipe,
  type RecipeItem,
  type RecipeSourceMode,
  type ResolvedPlanningFilters,
  type RetractPlanningInputResponse,
  requestTitle,
  roundNutrient,
  type StartRoundBody,
  type StartRoundResponse,
  type SuggestionFit,
} from "@yamt/shared";
import { newId } from "../db/index.ts";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys } from "../db/repos/jobs.ts";
import { isVoiceInput, type NewPlanningInput, toPlanningInput } from "../db/repos/planning-inputs.ts";
import type { OutlineIdea } from "../db/repos/planning-rounds.ts";
import { heicToJpeg } from "../media/heic.ts";
import type { MediaStore } from "../media/store.ts";
import { type MediaFile, storedFile, storeUpload } from "../media/upload.ts";
import { HttpError } from "./errors.ts";
import { requestZone } from "./goals.ts";
import { checkCapturedAt, nutrientTotals } from "./meals.ts";
import type { PlanningService } from "./planning.ts";
import { type RecipeService, recipeTotals, type SaveRecipeInput } from "./recipes.ts";
import { localDate } from "./time.ts";

/** Why an archived request's open round failed, and its jobs were cancelled. */
export const REQUEST_ARCHIVED = "the planning request was archived";

/** The reason an idea left `outlined` when its round ended gets. */
export const DIDNT_COMPLETE = "didn't complete";

/** Most why-lines a suggestion carries. */
export const MAX_WHY_LINES = 4;

const archived = () => new HttpError(409, REQUEST_ARCHIVED, "unarchive it first");

/** A complete suggestion as the agent saves it (#45's `save_suggestion`): its recipe and why it fits. */
export interface SaveSuggestionInput {
  /** Saved as a new recipe (validated like `save_recipe`); its title replaces the idea's. */
  recipe: SaveRecipeInput;
  why?: string[];
  /** Default: the idea's. */
  proposedDate?: string | null;
  proposedSlot?: MealSlot | null;
}

/** A round's outline (#45's `save_round_outline`). */
export interface SaveOutlineInput {
  ideas: {
    title: string;
    approach: string;
    sourceMode: RecipeSourceMode;
    sourceUrl?: string | null;
    proposedDate?: string | null;
    proposedSlot?: MealSlot | null;
  }[];
  /** Replaces the title code made from the filters. */
  requestTitle?: string | null;
}

interface RecipeData {
  recipe: Recipe;
  items: RecipeItem[];
}

/** Two computed totals added (or `b` subtracted), per nutrient, rounded as totals are. */
function addTotals(a: NutrientTotals | null, b: NutrientTotals, sign: 1 | -1 = 1): NutrientTotals {
  const base = a ?? { grams: 0, items: 0, nutrients: Object.fromEntries(CORE_NUTRIENTS.map((k) => [k, 0])) };
  return {
    grams: Math.max(0, Math.round((base.grams + sign * b.grams) * 10) / 10),
    items: Math.max(0, base.items + sign * b.items),
    nutrients: Object.fromEntries(
      CORE_NUTRIENTS.map((k) => [
        k,
        Math.max(0, roundNutrient(k, (base.nutrients[k] ?? 0) + sign * (b.nutrients[k] ?? 0))),
      ]),
    ) as NutrientTotals["nutrients"],
  };
}

/**
 * Planning requests (#36, #44): a request with complete filters and a title, inputs made like
 * captures (text, links, voice memos, photos, files; immutable, retracted softly, voice ones
 * transcribed), rounds (one open at a time; the inputs that arrived since the last round go into
 * the next one) whose suggestions a `plan` job fills (#45: `startRound`, `saveOutline`,
 * `saveSuggestion`, `failSuggestion`, `finishRound`, `failRound`, `requeueRound`), and the
 * verdicts: pick (a planned meal from the suggestion's recipe), reject, unreject. An archived
 * request takes no writes but an unarchive (409).
 */
export class PlanningRequestService {
  constructor(
    private readonly repos: Repos,
    private readonly media: MediaStore,
    private readonly recipes: RecipeService,
    private readonly planning: PlanningService,
    /** The server's zone: the default for a request's days. */
    private readonly timeZone: string,
    /** Seam for tests: the HEIC → JPEG conversion. */
    private readonly toJpeg: (heic: Uint8Array) => Promise<Uint8Array> = heicToJpeg,
    /** Called after a job was enqueued, so the worker picks it up without waiting for its tick. */
    private readonly jobsChanged: () => void = () => {},
    /** Stops the request's running `plan` job, if there is one; returns whether one ran. */
    private readonly stopRound: (requestId: string) => boolean = () => false,
    private readonly now: () => number = Date.now,
  ) {}

  // requests

  /**
   * A new request with its filters completed (`PLANNING_DEFAULTS`, today in its zone) and a title
   * from them; `text` becomes its first input. Idempotent with a client `id`.
   */
  create(
    body: CreatePlanningRequestBody,
    origin: PlanningOrigin = "user",
  ): { request: PlanningRequest; created: boolean } {
    if (body.id) {
      const existing = this.repos.planningRequests.get(body.id);
      if (existing) return { request: existing, created: false };
    }
    const timeZone = requestZone(body.tz, this.timeZone);
    const now = this.now();
    const filters = resolveFilters(body.filters, localDate(now, timeZone));
    const request = this.repos.db.transaction(() => {
      const request = this.repos.planningRequests.insert({
        id: body.id,
        title: requestTitle(filters),
        origin,
        filters,
        timeZone,
        now,
      });
      if (body.text) {
        this.repos.planningInputs.insert({
          id: newId(),
          requestId: request.id,
          kind: "text",
          text: body.text,
          now,
        });
      }
      return request;
    })();
    return { request, created: true };
  }

  /** The open requests, newest first, with their latest round counted and their inputs. */
  list(limit = 50): PlanningRequestsResponse {
    const requests = this.repos.planningRequests.listOpen(limit);
    const ids = requests.map((r) => r.id);
    const rounds = this.repos.planningRounds.latestTallies(ids);
    const inputs = this.repos.planningInputs.counts(ids);
    return {
      requests: requests.map((request) => ({
        request,
        latestRound: rounds.get(request.id) ?? null,
        inputs: inputs.get(request.id)?.live ?? 0,
        pendingInputs: inputs.get(request.id)?.pending ?? 0,
      })),
    };
  }

  /** The thread: the request, every input (retracted ones flagged), transcripts, rounds with suggestions. */
  detail(id: string): PlanningRequestDetail {
    const request = this.request(id);
    const inputs = this.repos.planningInputs.listForRequest(id);
    const byRound = this.repos.planningRounds.suggestionsOfRequest(id);
    const views = new Map(this.views(request, [...byRound.values()].flat()).map((v) => [v.id, v] as const));
    return {
      request,
      inputs: inputs.map(toPlanningInput),
      transcripts: this.repos.planningTranscripts.listForRequest(id),
      rounds: this.repos.planningRounds.listForRequest(id).map((round) => ({
        ...round,
        suggestions: (byRound.get(round.id) ?? []).map((s) => views.get(s.id)!),
      })),
      pendingInputs: inputs.filter((i) => i.roundId === null && i.retractedAt === null).length,
    };
  }

  /**
   * Out of the open list; idempotent. A queued round is failed and its job cancelled, a running
   * one stopped (its ideas not yet ready fail; what is ready stays).
   */
  archive(id: string): PlanningRequest {
    const before = this.request(id);
    if (before.archivedAt !== null) return before;
    const now = this.now();
    const request = this.repos.db.transaction(() => {
      const open = this.repos.planningRounds.open(id);
      if (open) this.endFailed(open.id, REQUEST_ARCHIVED, now);
      this.repos.jobs.cancelQueued(dedupeKeys.plan(id), REQUEST_ARCHIVED, now);
      return this.repos.planningRequests.setArchived(id, now, now)!;
    })();
    this.stopRound(id);
    return request;
  }

  /** Back in the open list; idempotent. A round the archive stopped stays failed (ask for more). */
  unarchive(id: string): PlanningRequest {
    const before = this.request(id);
    if (before.archivedAt === null) return before;
    return this.repos.planningRequests.setArchived(id, null, this.now())!;
  }

  // inputs

  /** A text or link input. Idempotent with a client `id`. */
  addJson(requestId: string, body: PlanningInputJsonBody): PlanningInputResponse & { created: boolean } {
    const request = this.request(requestId);
    const existing = this.existing(request, body.id);
    if (existing) return existing;
    if (request.archivedAt !== null) throw archived();
    const now = this.now();
    checkCapturedAt(body.capturedAt, now);
    return this.record({
      id: body.id ?? newId(),
      requestId,
      kind: body.kind,
      capturedAt: body.capturedAt ?? null,
      text: body.text ?? null,
      url: body.kind === "link" ? body.url : null,
      now,
    });
  }

  /**
   * An audio, image or file input, stored like a meal's capture (`storeUpload`: sniffed, the
   * original byte for byte, EXIF time, a JPEG for HEIC); a voice memo gets a pending transcript
   * and a `transcribe` job.
   */
  async addUpload(
    requestId: string,
    file: File,
    fields: PlanningUploadFields,
  ): Promise<PlanningInputResponse & { created: boolean }> {
    const request = this.request(requestId);
    const existing = this.existing(request, fields.id);
    if (existing) return existing;
    if (request.archivedAt !== null) throw archived();
    const now = this.now();
    checkCapturedAt(fields.capturedAt, now);
    const id = fields.id ?? newId();
    const stored = await storeUpload(this.media, this.toJpeg, id, file, fields.kind, now);
    try {
      return this.record({
        id,
        requestId,
        kind: fields.kind ?? stored.mediaKind,
        capturedAt: fields.capturedAt ?? null,
        takenAt: stored.takenAt,
        media: stored.media,
        now,
      });
    } catch (e) {
      await stored.discard();
      throw e;
    }
  }

  /** Soft retraction; idempotent. A voice input's queued transcription is cancelled. */
  retract(inputId: string): RetractPlanningInputResponse {
    const existing = this.repos.planningInputs.get(inputId);
    if (!existing) throw new HttpError(404, "planning input not found");
    if (this.request(existing.requestId).archivedAt !== null) throw archived();
    const now = this.now();
    return this.repos.db.transaction(() => {
      const input = this.repos.planningInputs.retract(inputId, now)!;
      if (isVoiceInput(input)) {
        this.repos.jobs.cancelQueued(dedupeKeys.transcribeInput(inputId), "input retracted", now);
      }
      this.repos.planningRequests.touch(input.requestId, now);
      return { input: toPlanningInput(input) };
    })();
  }

  mediaFile(inputId: string, variant: "original" | "jpeg"): MediaFile {
    const input = this.repos.planningInputs.get(inputId);
    if (!input) throw new HttpError(404, "planning input not found");
    return storedFile(this.media, input, variant, "input");
  }

  // rounds

  /**
   * Suggest: the request's first round, or a `steer` round when inputs arrived since the last one
   * (409 when nothing is new: ask for more instead). The new round takes those inputs.
   */
  suggest(requestId: string, body: StartRoundBody = {}): StartRoundResponse & { created: boolean } {
    return this.startNext(requestId, body, "suggest");
  }

  /**
   * Suggest more: another round with the same input (`more`); with inputs that arrived since the
   * last round it steers with them. 409 before the first round.
   */
  more(requestId: string, body: StartRoundBody = {}): StartRoundResponse & { created: boolean } {
    return this.startNext(requestId, body, "more");
  }

  private startNext(
    requestId: string,
    body: StartRoundBody,
    asked: "suggest" | "more",
  ): StartRoundResponse & { created: boolean } {
    const request = this.request(requestId);
    if (body.id) {
      const existing = this.repos.planningRounds.get(body.id);
      if (existing) {
        if (existing.requestId !== requestId)
          throw new HttpError(409, "id: a round of another request has this id");
        return { round: existing, jobId: this.jobOf(existing), created: false };
      }
    }
    if (request.archivedAt !== null) throw archived();
    const open = this.repos.planningRounds.open(requestId);
    if (open) {
      throw new HttpError(409, `round ${open.number} is ${open.status}`, "wait until it is done");
    }
    const rounds = this.repos.planningRounds.listForRequest(requestId);
    const pending = this.repos.planningInputs.counts([requestId]).get(requestId)?.pending ?? 0;
    let kind: PlanningRoundKind;
    if (rounds.length === 0) {
      if (asked === "more") throw new HttpError(409, "there is no round yet", "suggest first");
      kind = "first";
    } else if (pending > 0) kind = "steer";
    else if (asked === "more") kind = "more";
    else throw new HttpError(409, "nothing new since the last round", "add an input, or ask for more");

    const now = this.now();
    const res = this.repos.db.transaction(() => {
      const round = this.repos.planningRounds.insert({
        id: body.id,
        requestId,
        kind,
        count: request.filters.count,
        now,
      });
      this.repos.planningInputs.assignPending(requestId, round.id);
      const { job } = this.repos.jobs.enqueue(
        "plan",
        { roundId: round.id },
        { dedupeKey: dedupeKeys.plan(requestId), now },
      );
      this.repos.planningRequests.touch(requestId, now);
      return { round, jobId: job.id };
    })();
    this.jobsChanged();
    return { ...res, created: true };
  }

  /** The `plan` job that was queued for a round (a retried create answers it). */
  private jobOf(round: PlanningRound): string {
    const job = this.repos.jobs
      .list({ type: "plan" })
      .findLast((j) => j.type === "plan" && j.payload.roundId === round.id);
    return job?.id ?? "";
  }

  // the agent's side (#45's job and tools)

  /** A run takes the round: `queued` → `running`. */
  startRound(roundId: string, runId: string | null): PlanningRound {
    const round = this.round(roundId);
    if (this.request(round.requestId).archivedAt !== null) throw archived();
    if (round.status !== "queued") throw new HttpError(409, `the round is ${round.status}, not queued`);
    return this.repos.planningRounds.start(roundId, runId, this.now())!;
  }

  /**
   * The round's ideas, in order, as `outlined` suggestions (exactly its `count`); an earlier
   * outline (a failed attempt's) is replaced, unless one of its ideas is ready already. Each idea
   * proposes a day and slot; `requestTitle` replaces the request's title.
   */
  saveOutline(roundId: string, input: SaveOutlineInput): PlanningSuggestion[] {
    const round = this.running(roundId);
    const request = this.request(round.requestId);
    if (input.ideas.length !== round.count) {
      throw new HttpError(400, `ideas: the round asks for ${round.count}, not ${input.ideas.length}`);
    }
    if (this.repos.planningRounds.suggestions(roundId).some((s) => s.status === "ready")) {
      throw new HttpError(
        409,
        "the round's outline has ready suggestions",
        "save a suggestion to replace one",
      );
    }
    const ideas: OutlineIdea[] = input.ideas.map((i) => ({
      title: i.title.trim(),
      approach: i.approach.trim(),
      sourceMode: i.sourceMode,
      sourceUrl: i.sourceUrl?.trim() || null,
      proposedDate: i.proposedDate ?? null,
      proposedSlot: i.proposedSlot ?? null,
    }));
    const now = this.now();
    return this.repos.db.transaction(() => {
      const saved = this.repos.planningRounds.replaceOutline(roundId, ideas, now);
      const title = input.requestTitle?.trim();
      if (title) this.repos.planningRequests.setTitle(request.id, title, now);
      else this.repos.planningRequests.touch(request.id, now);
      return saved;
    })();
  }

  /**
   * An idea completed: its recipe saved (insert-only, validated like `save_recipe`), the suggestion
   * `ready` with the recipe's title, source and the why-lines; a second save of the position
   * replaces the first (unless the user has given a verdict on it). Returns it with its per-portion
   * totals and the fit.
   */
  saveSuggestion(roundId: string, position: number, input: SaveSuggestionInput): PlanningSuggestionView {
    const round = this.running(roundId);
    const request = this.request(round.requestId);
    const idea = this.idea(roundId, position);
    if (idea.verdict !== null) throw new HttpError(409, `the suggestion was ${idea.verdict} already`);
    const why = (input.why ?? []).map((w) => w.trim()).filter(Boolean);
    if (why.length > MAX_WHY_LINES) throw new HttpError(400, `why: at most ${MAX_WHY_LINES} lines`);
    const now = this.now();
    const saved = this.repos.db.transaction(() => {
      const { recipe } = this.recipes.save(input.recipe);
      const s = this.repos.planningRounds.markReady(
        idea.id,
        {
          title: recipe.title,
          sourceMode: recipe.sourceMode,
          sourceUrl: recipe.sourceUrl,
          proposedDate: input.proposedDate === undefined ? idea.proposedDate : input.proposedDate,
          proposedSlot: input.proposedSlot === undefined ? idea.proposedSlot : input.proposedSlot,
          recipeId: recipe.id,
          why,
        },
        now,
      )!;
      this.repos.planningRequests.touch(request.id, now);
      return s;
    })();
    return this.views(request, [saved])[0]!;
  }

  /** An idea that can't be completed, with the agent's reason. A ready one can't fail any more. */
  failSuggestion(roundId: string, position: number, reason: string): PlanningSuggestion {
    this.running(roundId);
    const idea = this.idea(roundId, position);
    if (idea.status === "ready")
      throw new HttpError(409, "the suggestion is ready", "save it again to replace it");
    return this.repos.planningRounds.markFailed(idea.id, reason.trim() || DIDNT_COMPLETE, this.now())!;
  }

  /**
   * The run ended: with at least one ready suggestion the round is `done` and the ideas left
   * `outlined` are `failed` ("didn't complete"). Without one nothing changes and null is the
   * answer: the job retries (`requeueRound`) or gives up (`failRound`).
   */
  finishRound(roundId: string): PlanningRound | null {
    const round = this.running(roundId);
    if (!this.repos.planningRounds.suggestions(roundId).some((s) => s.status === "ready")) return null;
    const now = this.now();
    return this.repos.db.transaction(() => {
      this.repos.planningRounds.failOutlined(roundId, DIDNT_COMPLETE, now);
      this.repos.planningRequests.touch(round.requestId, now);
      return this.repos.planningRounds.finish(roundId, "done", null, now)!;
    })();
  }

  /** The round failed for good, with the reason; ideas still `outlined` fail with it. */
  failRound(roundId: string, error: string): PlanningRound {
    const round = this.round(roundId);
    if (round.status === "done" || round.status === "failed") {
      throw new HttpError(409, `the round is ${round.status} already`);
    }
    return this.repos.db.transaction(() => this.endFailed(roundId, error, this.now()))();
  }

  /** Back to `queued` (a retry after a failed attempt, a server stop). */
  requeueRound(roundId: string, reason: string | null = null): PlanningRound {
    this.running(roundId);
    return this.repos.planningRounds.requeue(roundId, reason)!;
  }

  private endFailed(roundId: string, error: string, now: number): PlanningRound {
    this.repos.planningRounds.failOutlined(roundId, DIDNT_COMPLETE, now);
    const round = this.repos.planningRounds.finish(roundId, "failed", error, now)!;
    this.repos.planningRequests.touch(round.requestId, now);
    return round;
  }

  // verdicts

  /** One suggestion with its recipe, per-portion totals and the fit. */
  suggestion(id: string): PlanningSuggestionView {
    const s = this.suggestionRow(id);
    return this.views(this.request(this.round(s.roundId).requestId), [s])[0]!;
  }

  /**
   * Pick: a planned meal from the suggestion's recipe (naming the suggestion) on the given day
   * and slot, else the proposed ones (a proposed day in the past doesn't count), else the
   * request's next open slot; portions cooked default to the request's, the portion eaten to 1.
   * The suggestion is `picked` with its planned meal. Idempotent with the planned meal's client
   * `id`; a picked one otherwise is a 409 (change its planned meal instead), a rejected one too.
   */
  pick(id: string, body: PickSuggestionBody): PickSuggestionResponse & { created: boolean } {
    const s = this.suggestionRow(id);
    const request = this.request(this.round(s.roundId).requestId);
    if (body.id) {
      const existing = this.repos.plannedMeals.get(body.id);
      if (existing) {
        if (existing.suggestionId !== id) throw new HttpError(409, "id: another planned meal has this id");
        return {
          suggestion: this.suggestion(id),
          plannedMeal: this.planning.get(existing.id),
          created: false,
        };
      }
    }
    if (request.archivedAt !== null) throw archived();
    if (s.status !== "ready" || !s.recipeId) {
      throw new HttpError(409, `the suggestion is ${s.status}, not ready`, "pick a complete suggestion");
    }
    if (s.verdict === "picked") {
      throw new HttpError(409, "the suggestion was picked already", "change its planned meal instead");
    }
    if (s.verdict === "rejected")
      throw new HttpError(409, "the suggestion was rejected", "unreject it first");
    const recipe = this.repos.recipes.get(s.recipeId);
    if (!recipe) throw new Error(`suggestion ${id} names a missing recipe ${s.recipeId}`);
    const { date, slot } = this.pickTarget(s, request, body);
    const now = this.now();
    const planned = this.repos.db.transaction(() => {
      const planned = this.repos.plannedMeals.insert({
        id: body.id,
        date,
        slot,
        recipeId: recipe.id,
        title: recipe.title,
        portionsCooked: body.portionsCooked ?? request.filters.portionsCooked,
        portionEaten: body.portionEaten ?? 1,
        note: null,
        suggestionId: id,
        now,
      });
      this.repos.planningRounds.setVerdict(id, "picked", planned.id, now);
      this.repos.planningRequests.touch(request.id, now);
      return planned;
    })();
    return { suggestion: this.suggestion(id), plannedMeal: this.planning.get(planned.id), created: true };
  }

  /** "No": only a ready suggestion that isn't picked (unplan it first); idempotent. */
  reject(id: string): PlanningSuggestionView {
    const s = this.suggestionRow(id);
    if (s.verdict === "rejected") return this.suggestion(id);
    this.writable(s);
    if (s.status !== "ready") throw new HttpError(409, `the suggestion is ${s.status}, not ready`);
    if (s.verdict === "picked")
      throw new HttpError(409, "the suggestion was picked", "unplan its planned meal first");
    this.repos.planningRounds.setVerdict(id, "rejected", null, this.now());
    return this.suggestion(id);
  }

  /** Undoes a rejection; idempotent. */
  unreject(id: string): PlanningSuggestionView {
    const s = this.suggestionRow(id);
    if (s.verdict !== "rejected") {
      if (s.verdict === "picked") throw new HttpError(409, "the suggestion was picked, not rejected");
      return this.suggestion(id);
    }
    this.writable(s);
    this.repos.planningRounds.setVerdict(id, null, null, this.now());
    return this.suggestion(id);
  }

  /**
   * Where a pick goes: the body's day and slot, else the proposed ones (not a past day), else the
   * first of the request's days (today on) and slots that is still open (nothing eaten or planned;
   * for snacks: nothing planned), else the first of them.
   */
  private pickTarget(
    s: PlanningSuggestion,
    request: PlanningRequest,
    body: PickSuggestionBody,
  ): { date: string; slot: MealSlot } {
    const today = localDate(this.now(), request.timeZone);
    const proposed = s.proposedDate && s.proposedDate >= today ? s.proposedDate : null;
    const date = body.date ?? proposed;
    const slot = body.slot ?? s.proposedSlot;
    if (date && slot) return { date, slot };
    const slots = slot ? [slot] : request.filters.slots;
    let days = date ? [date] : request.filters.days.filter((d) => d >= today);
    if (days.length === 0) days = [today];
    const plan = this.planning.plan({ from: days[0]!, to: days.at(-1)!, tz: request.timeZone });
    const byDate = new Map(plan.days.map((d) => [d.date, d]));
    for (const d of days) {
      const day = byDate.get(d);
      for (const sl of slots) {
        if (!day || slotOpen(day, sl)) return { date: d, slot: sl };
      }
    }
    return { date: days[0]!, slot: slots[0] ?? "dinner" };
  }

  /**
   * Suggestions with their recipe, per-portion totals and the fit: each ready one on its day (the
   * proposed one, or its planned meal's once picked), from the plan's projection of that day. A
   * picked suggestion whose planned meal isn't skipped is in the projection already.
   */
  private views(
    request: PlanningRequest,
    suggestions: readonly PlanningSuggestion[],
  ): PlanningSuggestionView[] {
    const recipeIds = suggestions.flatMap((s) => (s.status === "ready" && s.recipeId ? [s.recipeId] : []));
    const recipes = this.repos.recipes.getMany(recipeIds);
    const items = this.repos.recipes.itemsOf(recipeIds);
    const days = new Map<string, PlanDay | undefined>();
    const dayOf = (date: string) => {
      if (!days.has(date)) {
        days.set(date, this.planning.plan({ from: date, to: date, tz: request.timeZone }).days[0]);
      }
      return days.get(date);
    };
    return suggestions.map((s) => {
      const recipe = s.recipeId && s.status === "ready" ? recipes.get(s.recipeId) : undefined;
      if (!recipe) return { ...s, recipe: null, perPortion: null, fit: null };
      const data = { recipe, items: items.get(recipe.id) ?? [] };
      const perPortion = portionTotals(data, 1);
      return { ...s, recipe, perPortion, fit: this.fit(s, data, perPortion, request, dayOf) };
    });
  }

  private fit(
    s: PlanningSuggestion,
    data: RecipeData,
    perPortion: NutrientTotals,
    request: PlanningRequest,
    dayOf: (date: string) => PlanDay | undefined,
  ): SuggestionFit | null {
    const planned = s.plannedMealId ? this.repos.plannedMeals.get(s.plannedMealId) : null;
    const date = planned?.date ?? s.proposedDate;
    const slot = planned?.slot ?? s.proposedSlot ?? request.filters.slots[0] ?? "dinner";
    if (!date) return null;
    const day = dayOf(date);
    const projected = day?.projected ?? null;
    let before: NutrientTotals | null;
    let withIt: NutrientTotals;
    if (planned && planned.status !== "skipped") {
      // in the projection already: through its planned meal, or the meal it logged
      const own =
        planned.status === "planned"
          ? (day?.plannedMeals.find((p) => p.id === planned.id)?.eaten ?? null)
          : (day?.meals.find((m) => m.plannedMealId === planned.id)?.totals ?? null);
      withIt = projected ?? portionTotals(data, planned.portionEaten);
      before = own && projected ? addTotals(projected, own, -1) : projected;
    } else {
      before = projected;
      withIt = addTotals(projected, planned ? portionTotals(data, planned.portionEaten) : perPortion);
    }
    const goal = day?.goal ?? null;
    const progress = goal ? dayProgress(withIt.nutrients, goal.targets) : null;
    return {
      date,
      slot,
      before,
      with: withIt,
      goal,
      progress,
      kcalLeft: progress?.energyKcal.left ?? null,
      proteinOpen: progress?.protein.left ?? null,
    };
  }

  // lookups

  private request(id: string): PlanningRequest {
    const r = this.repos.planningRequests.get(id);
    if (!r) throw new HttpError(404, "planning request not found");
    return r;
  }

  private round(id: string): PlanningRound {
    const r = this.repos.planningRounds.get(id);
    if (!r) throw new HttpError(404, "planning round not found");
    return r;
  }

  /** A round the agent may write to: `running`, its request not archived. */
  private running(id: string): PlanningRound {
    const round = this.round(id);
    if (round.status !== "running") throw new HttpError(409, `the round is ${round.status}, not running`);
    if (this.request(round.requestId).archivedAt !== null) throw archived();
    return round;
  }

  private idea(roundId: string, position: number): PlanningSuggestion {
    const s = this.repos.planningRounds.suggestionAt(roundId, position);
    if (!s)
      throw new HttpError(400, `position: the outline has no idea ${position}`, "save the outline first");
    return s;
  }

  private suggestionRow(id: string): PlanningSuggestion {
    const s = this.repos.planningRounds.getSuggestion(id);
    if (!s) throw new HttpError(404, "suggestion not found");
    return s;
  }

  /** A verdict may change: the suggestion's request isn't archived. */
  private writable(s: PlanningSuggestion): void {
    if (this.request(this.round(s.roundId).requestId).archivedAt !== null) throw archived();
  }

  /** A retried create: the input with the client's id, if it is stored (for this request). */
  private existing(
    request: PlanningRequest,
    id: string | undefined,
  ): (PlanningInputResponse & { created: false }) | null {
    if (!id) return null;
    const i = this.repos.planningInputs.get(id);
    if (!i) return null;
    if (i.requestId !== request.id) throw new HttpError(409, "id: an input of another request has this id");
    return {
      input: toPlanningInput(i),
      transcript: isVoiceInput(i) ? this.repos.planningTranscripts.get(id) : null,
      request,
      created: false,
    };
  }

  /** One transaction: the input, for a voice memo its transcript and job, the request touched. */
  private record(i: NewPlanningInput & { now: number }): PlanningInputResponse & { created: true } {
    const res = this.repos.db.transaction(() => {
      const input = this.repos.planningInputs.insert(i);
      let transcript = null;
      if (isVoiceInput(input)) {
        transcript = this.repos.planningTranscripts.upsertPending(input.id, i.now);
        this.repos.jobs.enqueue(
          "transcribe",
          { inputId: input.id },
          { dedupeKey: dedupeKeys.transcribeInput(input.id), now: i.now },
        );
      }
      this.repos.planningRequests.touch(input.requestId, i.now);
      return {
        input: toPlanningInput(input),
        transcript,
        request: this.repos.planningRequests.get(i.requestId)!,
      };
    })();
    if (res.transcript) this.jobsChanged();
    return { ...res, created: true };
  }
}

/** One portion × `factor` of a recipe, totalled. */
const portionTotals = ({ recipe, items }: RecipeData, factor: number): NutrientTotals =>
  nutrientTotals(recipeTotals(portionItems(recipe, items, factor)));

/** Nothing eaten or still planned in the slot (snacks: nothing planned; any number may be eaten). */
function slotOpen(day: PlanDay, slot: MealSlot): boolean {
  if (slot === "snack") return !day.plannedMeals.some((p) => p.slot === "snack" && p.status === "planned");
  return day.openSlots.includes(slot);
}

/**
 * The filters as given, completed with `PLANNING_DEFAULTS` and today: days sorted and distinct (none
 * before today, spanning at most `MAX_PLAN_DAYS`), slots in their order, constraints distinct.
 */
export function resolveFilters(f: PlanningFilters, today: string): ResolvedPlanningFilters {
  const days = [...new Set(f.days ?? [today])].sort();
  const past = days.find((d) => d < today);
  if (past) throw new HttpError(400, `filters.days: ${past} lies in the past`, `today is ${today}`);
  if (days.length > 1 && days.at(-1)! > addDays(days[0]!, MAX_PLAN_DAYS - 1)) {
    throw new HttpError(400, `filters.days: they span more than ${MAX_PLAN_DAYS} days`);
  }
  const slots = MealSlotEnum.options.filter((s) => (f.slots ?? PLANNING_DEFAULTS.slots).includes(s));
  return {
    days,
    slots,
    timeCapMin: f.timeCapMin ?? PLANNING_DEFAULTS.timeCapMin,
    constraints: [...new Set(f.constraints ?? PLANNING_DEFAULTS.constraints)],
    useUp: f.useUp ?? PLANNING_DEFAULTS.useUp,
    sourceMode: f.sourceMode ?? PLANNING_DEFAULTS.sourceMode,
    portionsCooked: f.portionsCooked ?? PLANNING_DEFAULTS.portionsCooked,
    count: f.count ?? PLANNING_DEFAULTS.count,
  };
}
