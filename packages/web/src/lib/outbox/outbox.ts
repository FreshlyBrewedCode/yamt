import { MAX_UPLOAD_BYTES } from "@yamt/shared";
import { uuidv7 } from "../ids";
import type {
  AnalyseEntry,
  CaptureEntry,
  OutboxEntry,
  OutboxStore,
  OutboxTransport,
  PendingCapture,
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
    if ("blob" in capture) {
      if (capture.blob.size === 0) throw new CaptureRejected(`${capture.fileName} is empty`);
      if (capture.blob.size > this.maxBytes) {
        throw new CaptureRejected(
          `${capture.fileName} is ${mb(capture.blob.size)}; the limit is ${mb(this.maxBytes)}`,
        );
      }
    }
    const now = this.now();
    const entry: CaptureEntry = {
      type: "capture",
      id: uuidv7(now),
      mealId,
      createdAt: now,
      capturedAt,
      capture,
      attempts: 0,
      nextAttemptAt: now,
      error: null,
      failed: false,
    };
    await this.opts.store.put(entry);
    this.entries = [...this.entries, entry].sort(byAge);
    this.changed();
    void this.flush();
    return entry;
  }

  /** Analyse the meal as soon as its queued captures are up. Idempotent per meal. */
  async requestAnalyse(mealId: string): Promise<AnalyseEntry> {
    const existing = this.entries.find((e): e is AnalyseEntry => e.type === "analyse" && e.mealId === mealId);
    if (existing) return existing;
    const now = this.now();
    const entry: AnalyseEntry = {
      type: "analyse",
      id: uuidv7(now),
      mealId,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      error: null,
      failed: false,
    };
    await this.opts.store.put(entry);
    this.entries = [...this.entries, entry].sort(byAge);
    this.changed();
    void this.flush();
    return entry;
  }

  /** Try a failed or waiting entry again now. */
  async retry(id: string): Promise<void> {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    await this.update({ ...e, failed: false, error: null, nextAttemptAt: this.now() });
    void this.flush();
  }

  /** Drops an entry that hasn't reached the server (the user's call, e.g. after a refusal). */
  async discard(id: string): Promise<void> {
    if (this.sending === id) return;
    await this.opts.store.delete(id);
    this.entries = this.entries.filter((e) => e.id !== id);
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

  /** An analyse request waits for every capture of its meal still in the queue. */
  private blocked(e: OutboxEntry): boolean {
    return e.type === "analyse" && this.entries.some((x) => x.type === "capture" && x.mealId === e.mealId);
  }

  private async send(e: OutboxEntry): Promise<"sent" | "retry" | "failed" | "offline"> {
    this.sending = e.id;
    this.changed();
    try {
      if (!this.ensured.has(e.mealId)) {
        await this.opts.transport.ensureMeal(e.mealId);
        this.ensured.add(e.mealId);
      }
      if (e.type === "capture") {
        await this.opts.transport.sendCapture(e, (f) => {
          this.progress = { ...this.progress, [e.id]: f };
          this.changed();
        });
      } else {
        await this.opts.transport.analyse(e.mealId);
      }
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
