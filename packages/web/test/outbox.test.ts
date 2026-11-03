import { describe, expect, test } from "bun:test";
import { backoffMs, CaptureRejected, Outbox } from "../src/lib/outbox/outbox";
import { MemoryStore } from "../src/lib/outbox/store";
import { type CaptureEntry, type OutboxTransport, TransportError } from "../src/lib/outbox/types";

/** A scripted server: records what arrives, fails as told. */
function fakeServer() {
  const log: string[] = [];
  const meals = new Set<string>();
  const captures = new Map<string, CaptureEntry>();
  let fail: ((what: string) => TransportError | null) | null = null;
  const transport: OutboxTransport = {
    async ensureMeal(mealId) {
      const err = fail?.(`meal ${mealId}`);
      if (err) throw err;
      log.push(`meal ${mealId}`);
      meals.add(mealId);
    },
    async sendCapture(e, onProgress) {
      const err = fail?.(`capture ${e.id} ${e.capture.kind}`);
      if (err) throw err;
      if (!meals.has(e.mealId)) throw new TransportError("meal not found", 404);
      onProgress(0.5);
      onProgress(1);
      log.push(`capture ${e.capture.kind}`);
      captures.set(e.id, e);
    },
    async analyse(mealId) {
      const err = fail?.(`analyse ${mealId}`);
      if (err) throw err;
      log.push(`analyse ${mealId}`);
    },
  };
  return {
    transport,
    log,
    captures,
    failWith: (f: typeof fail) => {
      fail = f;
    },
  };
}

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 1_000_000;
  let timer: { fn: () => void; at: number } | null = null;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      timer = { fn, at: now + ms };
      return timer;
    },
    clearTimer: () => {
      timer = null;
    },
    pending: () => (timer ? timer.at - now : null),
    /** Advances the clock and fires the timer if it is due. */
    async advance(ms: number) {
      now += ms;
      if (timer && timer.at <= now) {
        const t = timer;
        timer = null;
        t.fn();
      }
      await Bun.sleep(0);
    },
  };
}

function setup(opts: { online?: () => boolean; store?: MemoryStore } = {}) {
  const server = fakeServer();
  const time = fakeTime();
  const store = opts.store ?? new MemoryStore();
  const sent: string[] = [];
  const outbox = new Outbox({
    store,
    transport: server.transport,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    isOnline: opts.online,
    onSent: (e) => {
      sent.push(e.id);
    },
    maxBytes: 1000,
  });
  return { server, time, store, outbox, sent };
}

const blob = (n = 10, type = "audio/mp4") => new Blob([new Uint8Array(n)], { type });
const memo = () => ({ kind: "audio" as const, blob: blob(), fileName: "memo.m4a", mimeType: "audio/mp4" });

describe("outbox", () => {
  test("stores before sending, creates the meal once, sends oldest first, forgets what arrived", async () => {
    const { server, store, outbox, sent } = setup();
    await outbox.start();
    const a = await outbox.addCapture("m1", memo(), 111);
    expect(store.map.has(a.id)).toBe(true); // persisted before the upload
    const b = await outbox.addCapture("m1", { kind: "text", text: "Pasta" });
    await outbox.flush();
    expect(server.log).toEqual(["meal m1", "capture audio", "capture text"]);
    expect(server.captures.get(a.id)?.capturedAt).toBe(111);
    expect(store.map.size).toBe(0);
    expect(outbox.getSnapshot().entries).toEqual([]);
    expect(sent).toEqual([a.id, b.id]);
  });

  test("refuses what the server would refuse, before queueing it", async () => {
    const { outbox, store } = setup();
    await outbox.start();
    const big = {
      kind: "image" as const,
      blob: blob(2000, "image/jpeg"),
      fileName: "big.jpg",
      mimeType: "image/jpeg",
    };
    expect(outbox.addCapture("m1", big)).rejects.toBeInstanceOf(CaptureRejected);
    const empty = { ...big, blob: blob(0), fileName: "empty.jpg" };
    expect(outbox.addCapture("m1", empty)).rejects.toThrow("empty");
    expect(store.map.size).toBe(0);
  });

  test("network failures retry with backoff until the upload gets through", async () => {
    const { server, time, outbox } = setup();
    await outbox.start();
    let down = true;
    server.failWith(() => (down ? new TransportError("No connection") : null));
    const e = await outbox.addCapture("m1", memo());
    await outbox.flush();
    let entry = outbox.getSnapshot().entries[0]!;
    expect(entry).toMatchObject({ id: e.id, attempts: 1, failed: false, error: "No connection" });
    expect(time.pending()).toBe(backoffMs(1));

    await time.advance(backoffMs(1));
    await outbox.flush();
    entry = outbox.getSnapshot().entries[0]!;
    expect(entry.attempts).toBe(2);
    expect(time.pending()).toBe(backoffMs(2));

    down = false;
    await time.advance(backoffMs(2));
    await outbox.flush();
    expect(outbox.getSnapshot().entries).toEqual([]);
    expect(server.log).toEqual(["meal m1", "capture audio"]);
    expect(backoffMs(20)).toBe(60_000);
  });

  test("offline: nothing is attempted; coming back online sends at once", async () => {
    let online = false;
    const { server, outbox } = setup({ online: () => online });
    await outbox.start();
    await outbox.addCapture("m1", memo());
    await outbox.flush();
    expect(server.log).toEqual([]);
    expect(outbox.getSnapshot()).toMatchObject({ online: false, entries: [{ attempts: 0 }] });
    online = true;
    outbox.wake();
    await outbox.flush();
    expect(server.log).toEqual(["meal m1", "capture audio"]);
  });

  test("a refusal (4xx) stops retrying until the user retries or discards it", async () => {
    const { server, time, outbox, store } = setup();
    await outbox.start();
    server.failWith((what) => (what.startsWith("capture") ? new TransportError("not audio", 400) : null));
    const bad = await outbox.addCapture("m1", memo());
    await outbox.flush();
    expect(outbox.getSnapshot().entries[0]).toMatchObject({ failed: true, error: "not audio" });
    expect(time.pending()).toBeNull();

    server.failWith(null);
    await outbox.retry(bad.id);
    await outbox.flush();
    expect(outbox.getSnapshot().entries).toEqual([]);

    server.failWith(() => new TransportError("not audio", 400));
    const worse = await outbox.addCapture("m1", memo());
    await outbox.flush();
    await outbox.discard(worse.id);
    expect(outbox.getSnapshot().entries).toEqual([]);
    expect(store.map.size).toBe(0);
  });

  test("a 5xx is retried, and doesn't hold up the entries behind it", async () => {
    const { server, outbox } = setup();
    await outbox.start();
    server.failWith((what) => (what.endsWith("audio") ? new TransportError("oops", 503) : null));
    const first = await outbox.addCapture("m1", memo());
    await outbox.addCapture("m1", { kind: "text", text: "Salat" });
    await outbox.flush();
    expect(server.log).toEqual(["meal m1", "capture text"]);
    expect(outbox.getSnapshot().entries).toMatchObject([{ id: first.id, attempts: 1, failed: false }]);
  });

  test("analyse waits for the meal's captures, then runs once", async () => {
    const { server, outbox } = setup();
    await outbox.start();
    let down = true;
    server.failWith((what) =>
      down && what.startsWith("capture") ? new TransportError("No connection") : null,
    );
    await outbox.addCapture("m1", memo());
    await outbox.requestAnalyse("m1");
    await outbox.requestAnalyse("m1"); // idempotent
    await outbox.flush();
    expect(server.log).toEqual(["meal m1"]);
    expect(outbox.getSnapshot().entries.map((e) => e.type)).toEqual(["capture", "analyse"]);

    down = false;
    outbox.wake();
    await outbox.flush();
    expect(server.log).toEqual(["meal m1", "capture audio", "analyse m1"]);
    expect(outbox.getSnapshot().entries).toEqual([]);
  });

  test("survives a restart: a new queue over the same store sends what the last one left", async () => {
    const store = new MemoryStore();
    const first = setup({ store, online: () => false });
    await first.outbox.start();
    await first.outbox.addCapture("m1", memo());
    await first.outbox.addCapture("m2", { kind: "link", url: "https://example.com/recipe" });

    const second = setup({ store });
    await second.outbox.start();
    expect(second.server.log).toEqual(["meal m1", "capture audio", "meal m2", "capture link"]);
    expect(store.map.size).toBe(0);
  });

  test("reports upload progress while sending, and clears it after", async () => {
    const { outbox } = setup();
    await outbox.start();
    const seen: number[] = [];
    outbox.subscribe(() => {
      const p = Object.values(outbox.getSnapshot().progress);
      if (p.length) seen.push(p[0]!);
    });
    await outbox.addCapture("m1", memo());
    await outbox.flush();
    expect(seen).toContain(0.5);
    expect(outbox.getSnapshot().progress).toEqual({});
    expect(outbox.getSnapshot().sending).toBeNull();
  });
});

describe("uuidv7", () => {
  test("version 7, variant 10, ordered even within one millisecond", async () => {
    const { uuidv7 } = await import("../src/lib/ids");
    const ids = Array.from({ length: 5000 }, () => uuidv7(42));
    expect(
      ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)),
    ).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
