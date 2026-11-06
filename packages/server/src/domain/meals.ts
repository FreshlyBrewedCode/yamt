import {
  type AnalyseResponse,
  type CaptureResponse,
  type CreateMealBody,
  type DayTotals,
  isVoice,
  type JsonCaptureBody,
  MAX_UPLOAD_BYTES,
  type Meal,
  type MealDetailResponse,
  type MealItem,
  type MealRevisionsResponse,
  type MealSource,
  type MealSummary,
  type MealsQuery,
  type MealsResponse,
  type NutrientTotals,
  type RemoveMealResponse,
  type RepeatableQuery,
  type RepeatableResponse,
  type RepeatMealBody,
  type RepeatMealResponse,
  type RestoreMealResponse,
  type RetractResponse,
  type TranscribeResponse,
  type UpdateMealBody,
  type UploadCaptureFields,
} from "@yamt/shared";
import { newId } from "../db/index.ts";
import { type NewCapture, toCapture } from "../db/repos/captures.ts";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys } from "../db/repos/jobs.ts";
import { detectMediaType, isHeif, kindForMime, mimeFitsKind } from "../media/detect.ts";
import { exifTakenAt } from "../media/exif.ts";
import { heicToJpeg } from "../media/heic.ts";
import type { MediaStore } from "../media/store.ts";
import { HttpError } from "./errors.ts";
import { type RevisionService, totalsOf } from "./revisions.ts";
import { assertTimeZone, localDate, localTimeZone } from "./time.ts";

/** How far a client clock may run ahead before its `capturedAt` (or an `eatenAt`) is refused. */
export const CLOCK_SKEW_MS = 60 * 60_000;

/** Why the jobs of a removed meal were cancelled. */
export const MEAL_REMOVED = "the meal was removed";

/** The refusal of every write to a removed meal but a restore. */
export const mealRemoved = () => new HttpError(409, MEAL_REMOVED, "restore it first");

export interface MediaFile {
  /** Absolute. */
  path: string;
  mimeType: string;
  byteSize: number;
  /** Strong validator for caching and range requests. */
  etag: string;
}

/**
 * Meals and their captures: the rules the routes (and later the agent's tools) go through.
 * Captures are only ever added or retracted. An audio capture gets a pending transcript and a
 * `transcribe` job; analysing a meal queues it and enqueues one `analyse` job. A meal is removed
 * softly (`remove`, `restore`): a removed meal takes no writes (409).
 */
export class MealService {
  constructor(
    private readonly repos: Repos,
    private readonly media: MediaStore,
    private readonly revisionService: RevisionService,
    /** Seam for tests: the HEIC → JPEG conversion. */
    private readonly toJpeg: (heic: Uint8Array) => Promise<Uint8Array> = heicToJpeg,
    /** Called after a job was enqueued, so the worker picks it up without waiting for its tick. */
    private readonly jobsChanged: () => void = () => {},
    /**
     * Stops the meal's running analysis, if there is one (its run token revoked, its job aborted);
     * returns whether one ran. The server wires it to the worker; without one nothing runs.
     */
    private readonly stopAnalysis: (mealId: string) => boolean = () => false,
  ) {}

  /**
   * A new draft. With a client `id` it is idempotent: an existing meal with that id is answered
   * as it is (`created: false`), so a retried request never makes a second meal.
   */
  ensure(body: CreateMealBody): { meal: Meal; created: boolean } {
    if (body.id) {
      const existing = this.repos.meals.get(body.id);
      if (existing) return { meal: existing, created: false };
    }
    return { meal: this.repos.meals.insert({ id: body.id, eatenAt: body.eatenAt }), created: true };
  }

  create(body: CreateMealBody): Meal {
    return this.ensure(body).meal;
  }

  /**
   * The overview: meals with what they hold and their current revision's title, totals and open
   * questions, plus each day's totals (in `tz`) over those meals. Totals come from `totalsOf`.
   */
  list(q: MealsQuery): MealsResponse {
    const timeZone = q.tz ?? localTimeZone();
    try {
      assertTimeZone(timeZone);
    } catch {
      throw new HttpError(400, `tz: unknown time zone ${timeZone}`, "an IANA zone like Europe/Berlin");
    }
    const days = new Map<string, { meals: number; unanalysed: number; items: MealItem[] }>();
    const meals: MealSummary[] = this.repos.meals.list(q).map((m) => {
      const view = this.revisionService.current(m);
      const date = localDate(m.eatenAt, timeZone);
      const day = days.get(date) ?? { meals: 0, unanalysed: 0, items: [] };
      days.set(date, day);
      day.meals++;
      if (view) day.items.push(...view.items);
      else day.unanalysed++;
      return {
        ...m,
        title: view?.revision.title ?? null,
        totals: view ? nutrientTotals(view.totals) : null,
        openQuestions: view?.questions.filter((x) => x.answeredByCaptureId === null).length ?? 0,
      };
    });
    const dayTotals: DayTotals[] = [...days].map(([date, d]) => ({
      date,
      meals: d.meals,
      unanalysed: d.unanalysed,
      totals: nutrientTotals(totalsOf(d.items)),
    }));
    return { meals, days: dayTotals, timeZone };
  }

  detail(id: string): MealDetailResponse {
    const meal = this.meal(id);
    return {
      meal,
      captures: this.repos.captures.listForMeal(id).map(toCapture),
      transcripts: this.repos.transcripts.listForMeal(id),
      revision: this.revisionService.current(meal),
      runs: this.repos.runs.listForMeal(id),
      source: meal.sourceMealId ? this.sourceOf(meal.sourceMealId) : null,
    };
  }

  /** The meal another was logged again from, as it is now (its title may have changed since). */
  private sourceOf(mealId: string): MealSource | null {
    const m = this.repos.meals.get(mealId);
    if (!m) return null;
    const title = m.currentRevisionId ? (this.repos.revisions.get(m.currentRevisionId)?.title ?? null) : null;
    return { mealId: m.id, title, eatenAt: m.eatenAt };
  }

  /**
   * Logs a meal again (#30): a new meal at `eatenAt` (pinned) whose one revision is a copy of the
   * source's current revision: the same items with their foods and per-100 g snapshots, grams ×
   * `factor`, provenance, confidence and notes kept, the assumptions plus a line saying where it
   * came from. No run, no questions, no notification: the meal is `analysed` at once, and its
   * totals are computed from the copied items like any others. Idempotent with a client `id`.
   */
  repeat(
    sourceId: string,
    body: RepeatMealBody,
    now = Date.now(),
  ): RepeatMealResponse & { created: boolean } {
    const source = this.meal(sourceId);
    if (body.id) {
      const existing = this.repos.meals.get(body.id);
      if (existing) {
        if (existing.sourceMealId !== sourceId) {
          throw new HttpError(409, "id: another meal has this id");
        }
        const revision = this.revisionService.current(existing);
        if (!revision) throw new HttpError(409, "id: another meal has this id");
        return { meal: existing, revision, created: false };
      }
    }
    if (source.removedAt !== null) throw mealRemoved();
    const view = this.revisionService.current(source);
    if (view?.revision.status !== "analysed" || view.items.length === 0) {
      throw new HttpError(
        409,
        "nothing to log again: the meal has no finished analysis",
        "log a meal again once it is analysed",
      );
    }
    if (body.eatenAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "eatenAt lies in the future", "check the device clock");
    }
    const timeZone = body.tz ?? localTimeZone();
    try {
      assertTimeZone(timeZone);
    } catch {
      throw new HttpError(400, `tz: unknown time zone ${timeZone}`, "an IANA zone like Europe/Berlin");
    }
    const from = view.revision.title;
    const line = `Logged again from ${from} (${shortDate(source.eatenAt, timeZone)}), × ${body.factor}`;

    const created = this.repos.db.transaction(() => {
      const meal = this.repos.meals.insert({
        id: body.id,
        eatenAt: body.eatenAt,
        sourceMealId: source.id,
        now,
      });
      const revision = this.repos.revisions.insert({
        mealId: meal.id,
        runId: null,
        kind: "copy",
        sourceRevisionId: view.revision.id,
        title: view.revision.title,
        summary: view.revision.summary,
        eatenAt: body.eatenAt,
        assumptions: [...view.revision.assumptions, line],
        status: "analysed",
        items: view.items.map((i) => ({
          foodId: i.foodId,
          description: i.description,
          grams: scaleGrams(i.grams, body.factor),
          provenance: i.provenance,
          confidence: i.confidence,
          note: i.note,
          per100g: i.per100g,
        })),
        questions: [],
        now,
      });
      return this.repos.meals.setCurrentRevision(meal.id, revision.id, "analysed", now)!;
    })();
    return { meal: created, revision: this.revisionService.current(created)!, created: true };
  }

  /**
   * What the Log meal screen offers to log again (#30): analysed meals of the last `days` days
   * (none from the future), one per title (the latest of them), the most often logged first, then the most recent.
   */
  repeatable(q: RepeatableQuery, now = Date.now()): RepeatableResponse {
    const byTitle = new Map<string, { mealId: string; title: string; eatenAt: number; times: number }>();
    for (const { meal, title } of this.repos.meals.analysedBetween(
      now - q.days * 86_400_000,
      now + CLOCK_SKEW_MS,
    )) {
      const key = title.trim().replace(/\s+/g, " ").toLowerCase();
      const seen = byTitle.get(key);
      if (seen) seen.times++;
      else byTitle.set(key, { mealId: meal.id, title, eatenAt: meal.eatenAt, times: 1 });
    }
    const top = [...byTitle.values()]
      .sort((a, b) => b.times - a.times || b.eatenAt - a.eatenAt)
      .slice(0, q.limit);
    return {
      meals: top.flatMap((m) => {
        const view = this.revisionService.current(this.repos.meals.get(m.mealId)!);
        return view ? [{ ...m, totals: nutrientTotals(view.totals) }] : [];
      }),
    };
  }

  /** Every revision of the meal, newest first, with totals computed from its own items. */
  revisions(mealId: string): MealRevisionsResponse {
    this.meal(mealId);
    const revisions = this.repos.revisions
      .listForMeal(mealId)
      .reverse()
      .flatMap((r) => this.revisionService.view(r.id) ?? []);
    return { revisions };
  }

  /**
   * Sets when the meal was eaten. A time pins it (`user`: captures and the analysis leave it
   * alone from now on); `null` unpins it, and it follows the captures again.
   */
  update(mealId: string, body: UpdateMealBody, now = Date.now()): Meal {
    this.live(mealId);
    if (body.eatenAt === null) return this.repos.meals.unpinEatenAt(mealId, now)!;
    if (body.eatenAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "eatenAt lies in the future", "check the device clock");
    }
    return this.repos.meals.setEatenAt(mealId, body.eatenAt, "user", now)!;
  }

  /**
   * Text, link, correction and answer captures. An answer may name the question it answers,
   * which must be one of the meal's current revision (older questions were superseded).
   */
  addJson(mealId: string, body: JsonCaptureBody, now = Date.now()): CaptureResponse & { created: boolean } {
    const meal = this.meal(mealId);
    const existing = this.existing(mealId, body.id);
    if (existing) return existing;
    if (meal.removedAt !== null) throw mealRemoved();
    checkCapturedAt(body.capturedAt, now);
    const questionId = this.questionOf(meal, body.kind === "answer" ? body.questionId : undefined);
    return this.record({
      id: body.id ?? newId(),
      mealId,
      kind: body.kind,
      capturedAt: body.capturedAt ?? null,
      text: body.text ?? null,
      url: body.kind === "link" ? body.url : null,
      questionId,
      now,
    });
  }

  /**
   * Audio, image and file uploads, and spoken answers and corrections (audio only). The original
   * is stored byte for byte; photos get their EXIF time, HEIC/HEIF photos a JPEG derivative next
   * to the original (or `missing` if that fails); speech gets a pending transcript.
   */
  async addUpload(
    mealId: string,
    file: File,
    fields: UploadCaptureFields,
    now = Date.now(),
  ): Promise<CaptureResponse & { created: boolean }> {
    const meal = this.meal(mealId);
    const existing = this.existing(mealId, fields.id);
    if (existing) return existing;
    if (meal.removedAt !== null) throw mealRemoved();
    checkCapturedAt(fields.capturedAt, now);
    if (fields.questionId !== undefined && fields.kind !== "answer") {
      throw new HttpError(400, "questionId: only an answer answers a question");
    }
    const questionId = this.questionOf(meal, fields.questionId);
    if (file.size === 0) throw new HttpError(400, "the file is empty");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    }
    const bytes = await file.bytes();
    const fileName = file.name ? file.name.slice(0, 255) : null;
    // a spoken answer or correction is audio as far as the file goes
    const asked = fields.kind;
    const mediaKind = asked === "answer" || asked === "correction" ? "audio" : asked;
    const type = detectMediaType(bytes.subarray(0, 64), file.type, fileName, mediaKind);
    const kind = asked ?? kindForMime(type.mimeType);
    if (mediaKind && !mimeFitsKind(type.mimeType, mediaKind)) {
      throw new HttpError(
        400,
        `a ${type.mimeType} file is not ${mediaKind === "image" ? "an image" : "audio"}`,
      );
    }

    const id = fields.id ?? newId();
    const path = this.media.pathFor(id, type.ext, now);
    const written: string[] = [];
    try {
      const { byteSize, sha256 } = await this.media.write(path, bytes);
      written.push(path);
      let takenAt: number | null = null;
      let jpeg: { status: "ok"; path: string } | { status: "missing" } | null = null;
      if (kind === "image") {
        takenAt = await exifTakenAt(bytes);
        if (isHeif(type.mimeType)) {
          const jpegPath = this.media.pathFor(id, "jpg", now);
          try {
            await this.media.write(jpegPath, await this.toJpeg(bytes));
            written.push(jpegPath);
            jpeg = { status: "ok", path: jpegPath };
          } catch (e) {
            console.warn(`capture ${id}: no JPEG derivative (${(e as Error).message}); the original is kept`);
            jpeg = { status: "missing" };
          }
        }
      }
      return this.record({
        id,
        mealId,
        kind,
        capturedAt: fields.capturedAt ?? null,
        takenAt,
        media: { mimeType: type.mimeType, path, byteSize, sha256, fileName, jpeg },
        questionId,
        now,
      });
    } catch (e) {
      // nothing points at the files: don't leave orphans
      for (const p of written) await this.media.remove(p).catch(() => {});
      throw e;
    }
  }

  /** Soft retraction; idempotent. A retracted audio capture's queued transcription is cancelled. */
  retract(captureId: string, now = Date.now()): RetractResponse {
    const existing = this.repos.captures.get(captureId);
    if (!existing) throw new HttpError(404, "capture not found");
    this.live(existing.mealId);
    return this.repos.db.transaction(() => {
      const capture = this.repos.captures.retract(captureId, now)!;
      if (isVoice(capture)) {
        this.repos.jobs.cancelQueued(dedupeKeys.transcribe(captureId), "capture retracted", now);
      }
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      const meal = this.repos.meals.capturesChanged(capture.mealId, now)!;
      return { capture: toCapture(capture), meal };
    })();
  }

  /**
   * Runs an audio capture's transcription again (e.g. after a model change): the transcript goes
   * back to `pending` (the old text is dropped; the audio is never touched) and a `transcribe` job
   * is queued, or the queued one reused. An analysis of the meal that is queued waits for it; an
   * analysed meal is not analysed again by this (that's the user's call).
   */
  retranscribe(captureId: string, now = Date.now()): TranscribeResponse {
    const capture = this.repos.captures.get(captureId);
    if (!capture) throw new HttpError(404, "capture not found");
    if (!isVoice(capture)) throw new HttpError(400, "only voice captures have a transcript");
    if (capture.retractedAt !== null) throw new HttpError(409, "the capture was retracted");
    this.live(capture.mealId);
    const res = this.repos.db.transaction(() => {
      const transcript = this.repos.transcripts.upsertPending(captureId, now);
      const { job } = this.repos.jobs.enqueue(
        "transcribe",
        { captureId },
        { dedupeKey: dedupeKeys.transcribe(captureId), now },
      );
      return { capture: toCapture(capture), transcript, jobId: job.id };
    })();
    this.jobsChanged();
    return res;
  }

  /**
   * Queues the meal for analysis. Idempotent while a job is queued; while one runs, a new one
   * is queued behind it (it may have missed the latest captures). On a `failed` meal this is the
   * retry: a fresh job with fresh attempts, and the error is cleared.
   */
  analyse(mealId: string, now = Date.now()): AnalyseResponse {
    this.live(mealId);
    if (this.repos.captures.countLive(mealId) === 0) {
      throw new HttpError(409, "nothing to analyse yet", "add a capture first");
    }
    const result = this.repos.db.transaction(() => {
      const { job } = this.repos.jobs.enqueue(
        "analyse",
        { mealId },
        { dedupeKey: dedupeKeys.analyse(mealId), now },
      );
      const meal = this.repos.meals.setStatus(mealId, "queued", now)!;
      return { meal, jobId: job.id };
    })();
    this.jobsChanged();
    return result;
  }

  /**
   * Soft removal; idempotent (a removed meal is answered as it is). The meal leaves every list,
   * day, month, total, history and share target; nothing of it is deleted. A queued analysis is
   * cancelled and a running one stopped (it can't save any more: its token is revoked, and saving
   * onto a removed meal is refused), and so are the queued transcriptions of its voice captures.
   * A meal whose analysis was stopped stands where that analysis started from: its current
   * revision's status, or `draft` without one; a restore brings it back like that. A meal logged
   * from the plan puts its planned meal back to `planned`.
   */
  remove(mealId: string, now = Date.now()): RemoveMealResponse {
    const before = this.meal(mealId);
    if (before.removedAt !== null) return { meal: before, stoppedAnalysis: false };
    const busy = before.status === "queued" || before.status === "analysing";
    const { meal, cancelled } = this.repos.db.transaction(() => {
      const cancelled = this.repos.jobs.cancelQueued(dedupeKeys.analyse(mealId), MEAL_REMOVED, now);
      for (const c of this.repos.captures.listForMeal(mealId)) {
        if (isVoice(c)) this.repos.jobs.cancelQueued(dedupeKeys.transcribe(c.id), MEAL_REMOVED, now);
      }
      const current = before.currentRevisionId ? this.repos.revisions.get(before.currentRevisionId) : null;
      const status = busy ? (current?.status ?? "draft") : before.status;
      // a meal logged from the plan ("Ate it", #36): its planned meal is planned again
      this.repos.plannedMeals.unlogMeal(mealId, now);
      return { meal: this.repos.meals.remove(mealId, status, now)!, cancelled };
    })();
    const stopped = this.stopAnalysis(mealId);
    return { meal, stoppedAnalysis: cancelled > 0 || stopped };
  }

  /**
   * Undoes a removal; idempotent. The meal is back as it was removed (status, revision, time).
   * Voice captures whose transcription the removal cancelled are queued again; a stopped
   * analysis is not (the user presses Analyse: a run costs money). A meal logged from the plan
   * marks its planned meal `logged` again if it is still `planned`; otherwise it stays a meal of
   * its own.
   */
  restore(mealId: string, now = Date.now()): RestoreMealResponse {
    const before = this.meal(mealId);
    if (before.removedAt === null) return { meal: before };
    const { meal, queued } = this.repos.db.transaction(() => {
      const meal = this.repos.meals.restore(mealId, now)!;
      // logged from the plan: logged again, unless its planned meal was logged, skipped or unplanned since
      const planned = meal.sourcePlannedMealId ? this.repos.plannedMeals.get(meal.sourcePlannedMealId) : null;
      if (planned?.status === "planned") {
        this.repos.plannedMeals.markLogged(planned.id, mealId, planned.portionEaten, now);
      }
      const pending = new Set(
        this.repos.transcripts
          .listForMeal(mealId)
          .filter((t) => t.status === "pending")
          .map((t) => t.captureId),
      );
      let queued = 0;
      for (const c of this.repos.captures.listForMeal(mealId)) {
        const key = dedupeKeys.transcribe(c.id);
        if (c.retractedAt !== null || !pending.has(c.id) || this.repos.jobs.isOpen(key)) continue;
        this.repos.jobs.enqueue("transcribe", { captureId: c.id }, { dedupeKey: key, now });
        queued++;
      }
      return { meal, queued };
    })();
    if (queued > 0) this.jobsChanged();
    return { meal };
  }

  /** The stored file of a media capture: the original, or the JPEG derivative of a HEIC photo. */
  mediaFile(captureId: string, variant: "original" | "jpeg"): MediaFile {
    const c = this.repos.captures.get(captureId);
    if (!c) throw new HttpError(404, "capture not found");
    if (variant === "jpeg") {
      if (!c.jpegPath) throw new HttpError(404, "this capture has no JPEG derivative");
      const path = this.media.absolute(c.jpegPath);
      return { path, mimeType: "image/jpeg", byteSize: Bun.file(path).size, etag: `"${c.sha256}-jpeg"` };
    }
    if (!c.mediaPath || !c.mimeType || c.byteSize === null)
      throw new HttpError(404, "this capture has no media");
    return {
      path: this.media.absolute(c.mediaPath),
      mimeType: c.mimeType,
      byteSize: c.byteSize,
      etag: `"${c.sha256}"`,
    };
  }

  /**
   * A retried create: the capture with the client's id, if it is already stored (for this meal;
   * an id of another meal's capture is a conflict).
   */
  private existing(mealId: string, id: string | undefined): (CaptureResponse & { created: false }) | null {
    if (!id) return null;
    const c = this.repos.captures.get(id);
    if (!c) return null;
    if (c.mealId !== mealId) throw new HttpError(409, "id: a capture of another meal has this id");
    return {
      capture: toCapture(c),
      transcript: isVoice(c) ? this.repos.transcripts.get(id) : null,
      meal: this.meal(mealId),
      created: false,
    };
  }

  /** The question an answer names: it must be one of the meal's current revision. */
  private questionOf(meal: Meal, questionId: string | undefined): string | null {
    if (questionId === undefined) return null;
    const question = this.repos.revisions.question(questionId);
    if (!question || question.revisionId !== meal.currentRevisionId) {
      throw new HttpError(
        400,
        "questionId: not a question of this meal's current analysis",
        "answer one of the questions in the meal's current revision",
      );
    }
    return questionId;
  }

  private meal(id: string): Meal {
    const meal = this.repos.meals.get(id);
    if (!meal) throw new HttpError(404, "meal not found");
    return meal;
  }

  /** A meal that may be written to: it exists and wasn't removed (409 otherwise). */
  private live(id: string): Meal {
    const meal = this.meal(id);
    if (meal.removedAt !== null) throw mealRemoved();
    return meal;
  }

  /** One transaction: the capture, for audio its transcript and job, and the meal's times. */
  private record(c: NewCapture): CaptureResponse & { created: true } {
    const res = this.repos.db.transaction(() => {
      const capture = this.repos.captures.insert(c);
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      let transcript = null;
      if (isVoice(capture)) {
        transcript = this.repos.transcripts.upsertPending(capture.id, c.now);
        this.repos.jobs.enqueue(
          "transcribe",
          { captureId: capture.id },
          { dedupeKey: dedupeKeys.transcribe(capture.id), now: c.now },
        );
      }
      const meal = this.repos.meals.capturesChanged(capture.mealId, c.now)!;
      return { capture: toCapture(capture), transcript, meal };
    })();
    if (res.transcript) this.jobsChanged();
    return { ...res, created: true };
  }
}

export const nutrientTotals = ({ grams, items, nutrients }: NutrientTotals): NutrientTotals => ({
  grams,
  items,
  nutrients,
});

/** Grams × a portion factor, to the hundredth of a gram (never 0: items need grams). */
export const scaleGrams = (grams: number, factor: number) =>
  Math.max(0.01, Math.round(grams * factor * 100) / 100);

/** "Tue 3 Nov" in the zone: the source's day in a copy's assumption line. */
const shortDate = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone })
    .format(ms)
    .replace(",", "");

export function checkCapturedAt(capturedAt: number | undefined, now: number): void {
  if (capturedAt !== undefined && capturedAt > now + CLOCK_SKEW_MS) {
    throw new HttpError(400, "capturedAt lies in the future", "check the device clock");
  }
}
