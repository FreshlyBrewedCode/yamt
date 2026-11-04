import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db/index.ts";
import { dedupeKeys, JobRepo, retryDelayMs } from "../src/db/repos/jobs.ts";

let jobs: JobRepo;
beforeEach(() => {
  jobs = new JobRepo(openDb(":memory:"));
});

const T0 = 1_800_000_000_000;

describe("enqueue", () => {
  test("idempotent per dedupe key while queued; pulls runAfter earlier, never later", () => {
    const key = dedupeKeys.analyse("m1");
    const a = jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: key, now: T0, runAfter: T0 + 5_000 });
    const b = jobs.enqueue(
      "analyse",
      { mealId: "m1" },
      { dedupeKey: key, now: T0 + 1, runAfter: T0 + 9_000 },
    );
    const c = jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: key, now: T0 + 2 });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, job: { id: a.job.id, runAfter: T0 + 5_000 } });
    expect(c).toMatchObject({ created: false, job: { id: a.job.id, runAfter: T0 + 2 } });
    expect(jobs.list()).toHaveLength(1);
  });

  test("different keys and keyless jobs are independent", () => {
    jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: dedupeKeys.analyse("m1") });
    jobs.enqueue("analyse", { mealId: "m2" }, { dedupeKey: dedupeKeys.analyse("m2") });
    jobs.enqueue("transcribe", { captureId: "c1" });
    jobs.enqueue("transcribe", { captureId: "c1" });
    expect(jobs.list()).toHaveLength(4);
  });

  test("while a job with the key runs, a new request queues a second one behind it", () => {
    const key = dedupeKeys.analyse("m1");
    const first = jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: key, now: T0 }).job;
    expect(jobs.claim({ now: T0 })?.id).toBe(first.id);
    const second = jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: key, now: T0 + 1 });
    expect(second.created).toBe(true);
    // not claimable while the first one runs
    expect(jobs.claim({ now: T0 + 2 })).toBeNull();
    jobs.complete(first.id, T0 + 3);
    expect(jobs.claim({ now: T0 + 4 })?.id).toBe(second.job.id);
  });
});

describe("claim", () => {
  test("oldest due job first; not before runAfter; marks running and counts the attempt", () => {
    const late = jobs.enqueue("transcribe", { captureId: "late" }, { now: T0, runAfter: T0 + 60_000 }).job;
    const a = jobs.enqueue("transcribe", { captureId: "a" }, { now: T0 }).job;
    const b = jobs.enqueue("analyse", { mealId: "b" }, { now: T0 + 1 }).job;
    const claimed = jobs.claim({ now: T0 + 10 });
    expect(claimed).toMatchObject({ id: a.id, status: "running", attempts: 1, claimedAt: T0 + 10 });
    expect(claimed?.type === "transcribe" && claimed.payload.captureId).toBe("a");
    expect(jobs.claim({ now: T0 + 10 })?.id).toBe(b.id);
    expect(jobs.claim({ now: T0 + 10 })).toBeNull();
    expect(jobs.claim({ now: T0 + 60_000 })?.id).toBe(late.id);
  });

  test("filters by type", () => {
    jobs.enqueue("transcribe", { captureId: "a" }, { now: T0 });
    const an = jobs.enqueue("analyse", { mealId: "m" }, { now: T0 + 1 }).job;
    expect(jobs.claim({ types: ["analyse"], now: T0 + 5 })?.id).toBe(an.id);
    expect(jobs.claim({ types: ["analyse"], now: T0 + 5 })).toBeNull();
    expect(jobs.claim({ types: [], now: T0 + 5 })).toBeNull();
  });

  test("a claimed job is never handed out twice", () => {
    jobs.enqueue("transcribe", { captureId: "a" }, { now: T0 });
    const first = jobs.claim({ now: T0 });
    expect(first).not.toBeNull();
    expect(jobs.claim({ now: T0 })).toBeNull();
  });
});

describe("complete, fail, reschedule", () => {
  const claimOne = (opts: { maxAttempts?: number; key?: string } = {}) => {
    jobs.enqueue(
      "transcribe",
      { captureId: "c" },
      { now: T0, maxAttempts: opts.maxAttempts, dedupeKey: opts.key ?? null },
    );
    return jobs.claim({ now: T0 })!;
  };

  test("complete marks done; only running jobs can be completed", () => {
    const job = claimOne();
    expect(jobs.complete(job.id, T0 + 1)).toMatchObject({ status: "done", finishedAt: T0 + 1 });
    expect(jobs.complete(job.id, T0 + 2)).toBeNull();
  });

  test("fail retries with backoff until attempts are used up, then fails for good", () => {
    const job = claimOne({ maxAttempts: 2 });
    const retry = jobs.fail(job.id, "boom", { now: T0 + 100 });
    expect(retry).toMatchObject({ status: "queued", attempts: 1, lastError: "boom" });
    expect(retry?.runAfter).toBe(T0 + 100 + retryDelayMs(1));
    expect(jobs.claim({ now: T0 + 101 })).toBeNull();
    const again = jobs.claim({ now: T0 + 100 + retryDelayMs(1) })!;
    expect(again.attempts).toBe(2);
    expect(jobs.fail(again.id, "boom 2", { now: T0 + 200_000 })).toMatchObject({
      status: "failed",
      lastError: "boom 2",
      finishedAt: T0 + 200_000,
    });
  });

  test("a non-retryable failure is final at once", () => {
    const job = claimOne();
    expect(jobs.fail(job.id, "capture gone", { retryable: false })?.status).toBe("failed");
  });

  test("backoff grows and is capped", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([30_000, 120_000, 480_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });

  test("reschedule puts it back without spending an attempt", () => {
    const job = claimOne({ maxAttempts: 1 });
    const later = jobs.reschedule(job.id, T0 + 30_000, "waiting for transcripts", T0 + 1);
    expect(later).toMatchObject({ status: "queued", attempts: 0, runAfter: T0 + 30_000 });
    expect(jobs.claim({ now: T0 + 30_000 })?.attempts).toBe(1);
  });

  test("a retry superseded by a newer queued job with the same key is cancelled", () => {
    const key = dedupeKeys.analyse("m1");
    const job = claimOne({ key });
    const newer = jobs.enqueue("analyse", { mealId: "m1" }, { dedupeKey: key, now: T0 + 1 }).job;
    const failed = jobs.fail(job.id, "boom", { now: T0 + 2 });
    expect(failed?.status).toBe("cancelled");
    expect(failed?.lastError).toContain(newer.id);
    expect(jobs.list({ status: "queued" }).map((j) => j.id)).toEqual([newer.id]);
  });
});

describe("cancelQueued and releaseInterrupted", () => {
  test("cancelQueued only touches the queued job with that key", () => {
    const key = dedupeKeys.transcribe("c1");
    jobs.enqueue("transcribe", { captureId: "c1" }, { dedupeKey: key });
    expect(jobs.cancelQueued(key, "capture retracted")).toBe(1);
    expect(jobs.list()[0]).toMatchObject({ status: "cancelled", lastError: "capture retracted" });
    expect(jobs.cancelQueued(key, "again")).toBe(0);
  });

  test("jobs left running by a stopped server count an attempt and go back to the queue", () => {
    jobs.enqueue("transcribe", { captureId: "a" }, { now: T0, maxAttempts: 3 });
    jobs.enqueue("transcribe", { captureId: "b" }, { now: T0 + 1, maxAttempts: 1 });
    jobs.claim({ now: T0 + 1 });
    jobs.claim({ now: T0 + 1 });
    const released = jobs.releaseInterrupted(T0 + 10);
    expect(released.map((j) => j.status)).toEqual(["queued", "failed"]);
    expect(released[0]?.lastError).toContain("interrupted");
    expect(jobs.list({ status: "running" })).toEqual([]);
  });
});
