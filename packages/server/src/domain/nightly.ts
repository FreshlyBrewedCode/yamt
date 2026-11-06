import {
  addDays,
  MAX_STARTERS,
  type MealSlot,
  MIN_STARTERS,
  type NightlyResponse,
  type NightlySettings,
  type PlanningRequest,
  type PlanningStarter,
  type PlanningStarterView,
  type RegenerateNightlyBody,
  type RegenerateNightlyResponse,
  STARTERS_MAX_AGE_MS,
  type StarterInput,
} from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys, type Job } from "../db/repos/jobs.ts";
import { HttpError } from "./errors.ts";
import type { PlanningService } from "./planning.ts";
import type { PlanningRequestService } from "./planning-requests.ts";
import { planningSettings } from "./planning-settings.ts";
import { dayRange, localDate, offsetMs } from "./time.ts";

/** The slots a nightly request plans for, those still open today. */
export const NIGHTLY_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner"];

/** Why a queued nightly run was cancelled. */
export const NIGHTLY_OFF = "nightly suggestions are off";

/** `HH:MM` on a date, in the zone, as epoch ms (DST-safe: the offset at that time, not at midnight). */
export function localTimeAt(date: string, time: string, timeZone: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const midnight = dayRange(date, timeZone).from;
  const guess = midnight + (h * 60 + m) * 60_000;
  return guess + (offsetMs(midnight, timeZone) - offsetMs(guess, timeZone));
}

/**
 * When the nightly run is due next: `time` today in the zone if that is still ahead, else
 * tomorrow; never on `skipDate` (a day that has its nightly request already: one run a day).
 */
export function nextNightlyRun(time: string, timeZone: string, now: number, skipDate: string | null): number {
  let date = localDate(now, timeZone);
  for (let i = 0; i < 3; i++) {
    const at = localTimeAt(date, time, timeZone);
    if (at > now && date !== skipDate) return at;
    date = addDays(date, 1);
  }
  return localTimeAt(date, time, timeZone);
}

/** A starter as the agent saves it, defaults applied (`StarterInput` parsed). */
export type ParsedStarter = Required<Pick<StarterInput, "kind" | "text">> &
  Pick<PlanningStarter, "detail" | "filters" | "ref">;

/**
 * The nightly run (#36, #48): each day at Settings → Planning's time (the server's zone) a
 * planning request for today's open main slots (`origin: nightly`, filters from the planning
 * defaults, `count` from the nightly setting) with its first round queued, an ordinary thread
 * from then on. A scheduled `nightly` job in the queue runs it (`schedule`: one queued at the
 * next time while on, none while off; the job queues the next day's when it has run). Regenerate
 * runs it now. The earlier nightly requests go: at once those for past days or without a ready
 * suggestion, the rest once the new round is done (`supersede`), so today's suggestions stay
 * until the new ones arrive. The run also saves starters (`saveStarters`), which the entry screen
 * offers with a number the app computes.
 */
export class NightlyService {
  constructor(
    private readonly repos: Repos,
    private readonly planning: PlanningService,
    private readonly requests: PlanningRequestService,
    /** The server's zone: the run's time and "today". */
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {}

  settings(): NightlySettings {
    return planningSettings(this.repos.settings).nightly;
  }

  /** When the run is due next by the settings: never twice on a day that has a nightly request. */
  nextRunAt(now = this.now()): number {
    const last = this.repos.planningRequests.latestOf("nightly");
    const lastDate = last ? localDate(last.createdAt, this.timeZone) : null;
    return nextNightlyRun(this.settings().time, this.timeZone, now, lastDate);
  }

  /**
   * The queued `nightly` job, made to match the settings: none while off; while on, one at the
   * next run time (an overdue one stays: the server was down at its time, so it runs now). Called
   * at startup, after the settings change and after each run.
   */
  schedule(): Job | null {
    const now = this.now();
    const key = dedupeKeys.nightly;
    if (!this.settings().enabled) {
      this.repos.jobs.cancelQueued(key, NIGHTLY_OFF, now);
      return null;
    }
    const at = this.nextRunAt(now);
    const queued = this.repos.jobs.queued(key);
    if (queued && (queued.runAfter <= now || queued.runAfter === at)) return queued;
    return this.repos.db.transaction(() => {
      if (queued) this.repos.jobs.cancelQueued(key, "the nightly time changed", now);
      return this.repos.jobs.enqueue("nightly", {}, { dedupeKey: key, runAfter: at, now }).job;
    })();
  }

  /**
   * Today's nightly request with its first round queued, for today's open main slots; null when
   * none is open (everything eaten or planned: nothing to suggest). Earlier nightly requests for
   * past days, or without a ready suggestion, are archived first (one still running is stopped).
   */
  run(id?: string): RegenerateNightlyResponse | null {
    const now = this.now();
    const today = localDate(now, this.timeZone);
    for (const r of this.repos.planningRequests.listOpenOf("nightly")) {
      if (r.filters.days.every((d) => d < today) || !this.hasReady(r.id)) this.requests.archive(r.id);
    }
    const day = this.planning.plan({ from: today, to: today, tz: this.timeZone }).days[0];
    const slots = NIGHTLY_SLOTS.filter((s) => !day || day.openSlots.includes(s));
    if (slots.length === 0) return null;
    const { request, created } = this.requests.create(
      { id, filters: { days: [today], slots, count: this.settings().count }, tz: this.timeZone },
      "nightly",
    );
    // the round's `plan` job wakes the worker
    if (created) this.requests.suggest(request.id);
    return { request, slots };
  }

  /**
   * Regenerate: a new nightly request now (whether or not the run is on); today's earlier one
   * stays until the new round is done. Idempotent with the new request's client `id`; 409 when
   * nothing is open today.
   */
  regenerate(body: RegenerateNightlyBody): RegenerateNightlyResponse {
    if (body.id) {
      const existing = this.repos.planningRequests.get(body.id);
      if (existing) {
        if (existing.origin !== "nightly") throw new HttpError(409, "id: another request has this id");
        return { request: existing, slots: existing.filters.slots };
      }
    }
    const res = this.run(body.id);
    if (!res) {
      throw new HttpError(409, "nothing is open today", "everything today is eaten or planned already");
    }
    return res;
  }

  /**
   * A nightly request's first round is done: the earlier open nightly requests go (archived; what
   * was picked from them stays planned). Returns how many.
   */
  supersede(roundId: string): number {
    const round = this.repos.planningRounds.get(roundId);
    const request = round ? this.repos.planningRequests.get(round.requestId) : null;
    if (!round || !request || request.origin !== "nightly" || round.number !== 1 || round.status !== "done")
      return 0;
    const older = this.repos.planningRequests
      .listOpenOf("nightly")
      .filter((r) => r.id !== request.id && before(r, request));
    for (const r of older) this.requests.archive(r.id);
    return older.length;
  }

  /**
   * The starters of a nightly round (`save_starters`), replacing any it saved before: between
   * `MIN_STARTERS` and `MAX_STARTERS`, each reference naming something that exists.
   */
  saveStarters(roundId: string, starters: readonly ParsedStarter[]): PlanningStarter[] {
    const round = this.repos.planningRounds.get(roundId);
    if (!round) throw new HttpError(404, "planning round not found");
    const request = this.repos.planningRequests.get(round.requestId)!;
    if (request.origin !== "nightly") {
      throw new HttpError(409, "starters come with the nightly run", "only a nightly round saves them");
    }
    if (request.archivedAt !== null) throw new HttpError(409, "the planning request was archived");
    if (round.status !== "running") throw new HttpError(409, `the round is ${round.status}, not running`);
    if (starters.length < MIN_STARTERS || starters.length > MAX_STARTERS) {
      throw new HttpError(400, `starters: ${MIN_STARTERS} to ${MAX_STARTERS}, not ${starters.length}`);
    }
    for (const [i, s] of starters.entries()) {
      const { mealId, requestId, recipeId, leftoverId } = s.ref;
      const meal = mealId ? this.repos.meals.get(mealId) : null;
      if (mealId && (!meal || meal.removedAt !== null)) throw refError(i, "mealId", mealId);
      if (requestId && !this.repos.planningRequests.get(requestId)) throw refError(i, "requestId", requestId);
      if (recipeId && !this.repos.recipes.get(recipeId)) throw refError(i, "recipeId", recipeId);
      // the leftovers list is #49's: until then no id names one
      if (leftoverId) throw refError(i, "leftoverId", leftoverId);
    }
    return this.repos.planningStarters.replace(
      roundId,
      starters.map((s) => ({ kind: s.kind, text: s.text, detail: s.detail, filters: s.filters, ref: s.ref })),
      this.now(),
    );
  }

  /**
   * The entry screen's nightly part: the settings, when the run is due, the open nightly requests
   * for today or later (newest first) and the latest starters with what their references name.
   */
  view(): NightlyResponse {
    const now = this.now();
    const today = localDate(now, this.timeZone);
    const settings = this.settings();
    const requests = this.repos.planningRequests
      .listOpenOf("nightly")
      .filter((r) => r.filters.days.some((d) => d >= today))
      .map((r) => this.requests.detail(r.id));
    return {
      settings,
      timeZone: this.timeZone,
      nextRunAt: settings.enabled
        ? (this.repos.jobs.queued(dedupeKeys.nightly)?.runAfter ?? this.nextRunAt(now))
        : null,
      requests,
      starters: this.repos.planningStarters.latest(now - STARTERS_MAX_AGE_MS).map((s) => this.starterView(s)),
    };
  }

  private starterView(s: PlanningStarter): PlanningStarterView {
    const meal = s.ref.mealId ? this.repos.meals.get(s.ref.mealId) : null;
    const request = s.ref.requestId ? this.repos.planningRequests.get(s.ref.requestId) : null;
    const title = meal?.currentRevisionId
      ? (this.repos.revisions.get(meal.currentRevisionId)?.title ?? null)
      : null;
    return {
      ...s,
      meal: meal && meal.removedAt === null ? { id: meal.id, title, eatenAt: meal.eatenAt } : null,
      request: request ? { id: request.id, title: request.title, createdAt: request.createdAt } : null,
    };
  }

  private hasReady(requestId: string): boolean {
    return [...this.repos.planningRounds.suggestionsOfRequest(requestId).values()]
      .flat()
      .some((s) => s.status === "ready");
  }
}

/** Made before `b` (ids are UUIDv7: they order like their times). */
const before = (a: PlanningRequest, b: PlanningRequest) =>
  a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

const refError = (i: number, field: string, id: string) =>
  new HttpError(400, `starters[${i}].ref.${field}: nothing has the id ${id}`);
