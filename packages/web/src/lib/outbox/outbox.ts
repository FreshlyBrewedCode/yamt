import { MAX_UPLOAD_BYTES } from "@yamt/shared";
import { uuidv7 } from "../ids";
import type {
  AnalyseEntry,
  CaptureEntry,
  OutboxEntry,
  OutboxStore,
  OutboxTransport,
  PendingCapture,
  PendingPlanningInput,
  PlanInputEntry,
  PlanRequestEntry,
  PlanRoundEntry,
} from "./types";

/**
 * The upload queue: **uploads never lose data.** Every capture is written to the store
 * (IndexedDB) before anything is sent, and stays there until the server has confirmed it. The
 * queue then sends entries one at a time, oldest first:
 *
 * - the meal is created first (idempotent, by the client's meal id), so a meal can be started
 *   offline and appear on the server with its first capture;
 * - a capture is sent with its client id, so a retry after a lost response never stores it twice;
 * - an analyse request waits until every capture of its meal is up (or discarded);
 * - a planning request (#47) works the same way: the request is created with its client id
 *   first, then its inputs, then a round, which waits for the inputs queued before it;
 * - a network failure or a 5xx/408/429 retries with backoff (2 s, 4 s … 60 s), at once when the
 *   browser comes back online or the app is opened again; any other refusal (4xx) marks the
 *   entry failed with the server's reason until the user retries or discards it.
 */

export interface OutboxSnapshot {
  /** Oldest first. */
  entries: readonly OutboxEntry[];
  /** Upload progress (0–1) of the entry being sent, by id. */
  progress: Readonly<Record<string, number>>;
  /** The entry being sent right now. */
  sending: string | null;
  online: boolean;
  /** The store has been read (before that, `entries` is empty for lack of knowledge). */
  ready: boolean;
}

export interface OutboxOptions {
  store: OutboxStore;
  transport: OutboxTransport;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  isOnline?: () => boolean;
  /**
   * After the server confirmed an entry and before the queue forgets it: refresh the meal's
   * queries here, so the capture never vanishes from the screen in between.
   */
  onSent?: (entry: OutboxEntry) => void | Promise<void>;
  maxBytes?: number;
}

/** Refused before it is queued: too large, empty, or not something the server takes. */
export class CaptureRejected extends Error {}

const MAX_BACKOFF_MS = 60_000;
export const backoffMs = (attempts: number): number =>
  Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));

const retryable = (status: number | undefined): boolean =>
  status === undefined || status >= 500 || status === 408 || status === 429;

/** Ids are UUIDv7 with a counter, so their order is the order they were made in. */
const byAge = (a: OutboxEntry, b: OutboxEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class Outbox {
  private entries: OutboxEntry[] = [];
  private progress: Record<string, number> = {};
  private sending: string | null = null;
  private ready = false;
  private snapshot: OutboxSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly ensured = new Set<string>();
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly isOnline: () => boolean;
  private readonly maxBytes: number;

  constructor(private readonly opts: OutboxOptions) {
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.isOnline = opts.isOnline ?? (() => true);
    this.maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
    this.snapshot = this.makeSnapshot();
  }

  /** Reads what an earlier visit left behind and starts sending it. */
  async start(): Promise<void> {
    const stored = await this.opts.store.all();
    const known = new Set(this.entries.map((e) => e.id));
    this.entries = [...this.entries, ...stored.filter((e) => !known.has(e.id))].sort(byAge);
    this.ready = true;
    this.changed();
    await this.flush();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OutboxSnapshot => this.snapshot;

  /**
   * Queues a capture; resolves once it is stored locally (not when it is uploaded). Throws
   * `CaptureRejected` for what the server would refuse anyway (empty, larger than the limit).
   */
  async addCapture(mealId: string, capture: PendingCapture, capturedAt = this.now()): Promise<CaptureEntry> {
    this.check(capture);
    const now = this.now();
    return this.add<CaptureEntry>({ type: "capture", ...this.fresh(now), mealId, capturedAt, capture });
  }

  /**
   * A planning request (#47) made on this phone, with its complete filters and the phone's zone; a
   * text alone goes along with it (the request's first input). Idempotent per request id.
   */
  async addPlanningRequest(
    request: Pick<PlanRequestEntry, "requestId" | "filters" | "tz" | "text">,
  ): Promise<PlanRequestEntry> {
    const existing = this.entries.find(
      (e): e is PlanRequestEntry => e.type === "plan-request" && e.requestId === request.requestId,
    );
    if (existing) return existing;
    const now = this.now();
    return this.add<PlanRequestEntry>({ type: "plan-request", ...this.fresh(now), ...request });
  }

  /**
   * An input of a planning request: like a capture (the same limits), sent once the request is up.
   * Throws `CaptureRejected` for what the server would refuse anyway.
   */
  async addPlanningInput(
    requestId: string,
    input: PendingPlanningInput,
    capturedAt = this.now(),
  ): Promise<PlanInputEntry> {
    this.check(input);
    const now = this.now();
    return this.add<PlanInputEntry>({ type: "plan-input", ...this.fresh(now), requestId, capturedAt, input });
  }

  /**
   * A new round for the request (`suggest`: the first or a steer; `more`: the same input again),
   * sent once the request and the inputs queued before it are up. One waiting round per request:
   * asking again while one waits answers that one (and tries a refused one again).
   */
  async requestRound(requestId: string, kind: PlanRoundEntry["kind"]): Promise<PlanRoundEntry> {
    const existing = this.entries.find(
      (e): e is PlanRoundEntry => e.type === "plan-round" && e.requestId === requestId,
    );
    if (existing) {
      if (existing.failed) await this.retry(existing.id);
      return existing;
    }
    const now = this.now();
    return this.add<PlanRoundEntry>({ type: "plan-round", ...this.fresh(now), requestId, kind });
  }

  /** Analyse the meal as soon as its queued captures are up. Idempotent per meal. */
  async requestAnalyse(mealId: string): Promise<AnalyseEntry> {
    const existing = this.entries.find((e): e is AnalyseEntry => e.type === "analyse" && e.mealId === mealId);
    if (existing) return existing;
    const now = this.now();
    return this.add<AnalyseEntry>({ type: "analyse", ...this.fresh(now), mealId });
  }

  /** What every new entry starts with. */
  private fresh(now: number) {
    return { id: uuidv7(now), createdAt: now, attempts: 0, nextAttemptAt: now, error: null, failed: false };
  }

  /** Stored first, then queued and sent. */
  private async add<T extends OutboxEntry>(entry: T): Promise<T> {
    await this.opts.store.put(entry);
    this.entries = [...this.entries, entry].sort(byAge);
    this.changed();
    void this.flush();
    return entry;
  }

  private check(capture: PendingCapture): void {
    checkCapture(capture, this.maxBytes);
  }

  /** Try a failed or waiting entry again now. */
  async retry(id: string): Promise<void> {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    await this.update({ ...e, failed: false, error: null, nextAttemptAt: this.now() });
    void this.flush();
  }

  /**
   * Drops an entry that hasn't reached the server (the user's call, e.g. after a refusal). A
   * planning request takes its waiting inputs and round along: they have nowhere to go.
   */
  async discard(id: string): Promise<void> {
    if (this.sending === id) return;
    const e = this.entries.find((x) => x.id === id);
    const gone = this.entries.filter(
      (x) =>
        x.id === id ||
        (e?.type === "plan-request" &&
          x.type !== "plan-request" &&
          "requestId" in x &&
          x.requestId === e.requestId),
    );
    if (gone.some((x) => x.id === this.sending)) return;
    for (const x of gone) await this.opts.store.delete(x.id);
    const ids = new Set(gone.map((x) => x.id));
    this.entries = this.entries.filter((x) => !ids.has(x.id));
    this.changed();
    void this.flush();
  }

  /** The network is back or the app was reopened: everything waiting is due now. */
  wake(): void {
    const now = this.now();
    this.entries = this.entries.map((e) =>
      e.failed || e.nextAttemptAt <= now ? e : { ...e, nextAttemptAt: now },
    );
    this.changed(); // also carries the new online state
    void this.flush();
  }

  /** One pass over everything due; concurrent calls share it (and trigger one more pass). */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again);
      } finally {
        this.flushing = null;
        this.schedule();
        this.changed();
      }
    })();
    return this.flushing;
  }

  private async pass(): Promise<void> {
    if (!this.ready) return;
    for (;;) {
      if (!this.isOnline()) return;
      const next = this.nextDue(this.now());
      if (!next) return;
      const outcome = await this.send(next);
      // the network is down: everything else would fail the same way; wait for the timer/online
      if (outcome === "offline") return;
    }
  }

  private nextDue(now: number): OutboxEntry | undefined {
    return this.entries.find((e) => !e.failed && e.nextAttemptAt <= now && !this.blocked(e));
  }

  /**
   * An analyse request waits for every capture of its meal still in the queue; a planning input or
   * round for its request; a round for the inputs of its request queued before it.
   */
  private blocked(e: OutboxEntry): boolean {
    switch (e.type) {
      case "capture":
      case "plan-request":
        return false;
      case "analyse":
        return this.entries.some((x) => x.type === "capture" && x.mealId === e.mealId);
      case "plan-input":
        return this.entries.some((x) => x.type === "plan-request" && x.requestId === e.requestId);
      case "plan-round":
        return this.entries.some(
          (x) =>
            (x.type === "plan-request" && x.requestId === e.requestId) ||
            (x.type === "plan-input" && x.requestId === e.requestId && x.id < e.id),
        );
    }
  }

  private async send(e: OutboxEntry): Promise<"sent" | "retry" | "failed" | "offline"> {
    this.sending = e.id;
    this.changed();
    try {
      const onProgress = (f: number) => {
        this.progress = { ...this.progress, [e.id]: f };
        this.changed();
      };
      if ((e.type === "capture" || e.type === "analyse") && !this.ensured.has(e.mealId)) {
        await this.opts.transport.ensureMeal(e.mealId);
        this.ensured.add(e.mealId);
      }
      if (e.type === "capture") await this.opts.transport.sendCapture(e, onProgress);
      else if (e.type === "analyse") await this.opts.transport.analyse(e.mealId);
      else if (e.type === "plan-request") await this.opts.transport.createPlanningRequest(e);
      else if (e.type === "plan-input") await this.opts.transport.sendPlanningInput(e, onProgress);
      else await this.opts.transport.startRound(e);
      await Promise.resolve(this.opts.onSent?.(e)).catch(() => {});
      await this.opts.store.delete(e.id);
      this.entries = this.entries.filter((x) => x.id !== e.id);
      return "sent";
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = err instanceof Error ? err.message : String(err);
      if (retryable(status)) {
        const attempts = e.attempts + 1;
        await this.update({
          ...e,
          attempts,
          nextAttemptAt: this.now() + backoffMs(attempts),
          error: message,
        });
        return status === undefined ? "offline" : "retry";
      }
      await this.update({ ...e, attempts: e.attempts + 1, failed: true, error: message });
      return "failed";
    } finally {
      const { [e.id]: _, ...rest } = this.progress;
      this.progress = rest;
      this.sending = null;
      this.changed();
    }
  }

  private async update(e: OutboxEntry): Promise<void> {
    if (!this.entries.some((x) => x.id === e.id)) return; // discarded meanwhile
    await this.opts.store.put(e);
    this.entries = this.entries.map((x) => (x.id === e.id ? e : x));
    this.changed();
  }

  /** Wakes the queue when the earliest waiting entry is due. */
  private schedule(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const waiting = this.entries.filter((e) => !e.failed && !this.blocked(e));
    if (waiting.length === 0) return;
    const at = Math.min(...waiting.map((e) => e.nextAttemptAt));
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(0, at - this.now()),
    );
  }

  private makeSnapshot(): OutboxSnapshot {
    return {
      entries: this.entries,
      progress: this.progress,
      sending: this.sending,
      online: this.isOnline(),
      ready: this.ready,
    };
  }

  private changed(): void {
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Refuses what the server would refuse anyway: an empty file, or one over the limit. The queue
 * checks every capture; the planning composer checks an attachment as it is attached.
 */
export function checkCapture(capture: PendingCapture, maxBytes = MAX_UPLOAD_BYTES): void {
  if (!("blob" in capture)) return;
  if (capture.blob.size === 0) throw new CaptureRejected(`${capture.fileName} is empty`);
  if (capture.blob.size > maxBytes) {
    throw new CaptureRejected(
      `${capture.fileName} is ${mb(capture.blob.size)}; the limit is ${mb(maxBytes)}`,
    );
  }
}
