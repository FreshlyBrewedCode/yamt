import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalysisRun,
  type MealDetailResponse,
  mealPaths,
  type RunResponse,
  runPaths,
  type TraceEntry,
} from "@yamt/shared";
import type { AnalysisConfig } from "../src/config.ts";
import { dataPaths } from "../src/config.ts";
import { newId } from "../src/db/index.ts";
import { dedupeKeys } from "../src/db/repos/jobs.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { fakeAgentConfig, fixture, tempDir } from "./helpers.ts";

const fakeHarness = (env: Record<string, string> = {}): AnalysisConfig => fakeAgentConfig(env);

function start(dataDir = join(tempDir(), "data"), env: Record<string, string> = { FAKE_ACP_IMAGES: "1" }) {
  return createServer({
    dataDir,
    port: 0,
    webDist: null,
    auth: { kind: "off" },
    worker: { pollMs: 20 },
    analysis: {
      config: fakeHarness(env),
      timeouts: { idleMs: 1500, toolIdleMs: 1500, turnMs: 10_000, cancelGraceMs: 300 },
      transcriptWaitMs: 50,
    },
  });
}

setDefaultTimeout(30_000);
const app = start();
const s = app.services;
afterAll(() => app.stop());

async function waitFor<T>(
  what: string,
  fn: () => T | null | undefined | false,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

/** A meal with text captures (the first `fake:` one scripts the fake agent). */
function meal(...texts: string[]) {
  const m = s.meals.create({});
  for (const text of texts) s.meals.addJson(m.id, { kind: "text", text });
  return m.id;
}

const status = (mealId: string) => s.repos.meals.get(mealId)!.status;
const runs = (mealId: string) => s.repos.runs.listForMeal(mealId);
const settledMeal = (mealId: string, ...statuses: string[]) =>
  waitFor(`meal ${statuses.join("/")}`, () => statuses.includes(status(mealId)) && s.repos.meals.get(mealId));
const finishedRun = (mealId: string, n = 1) =>
  waitFor(`${n} finished run(s)`, () => {
    const r = runs(mealId).filter((x) => x.status !== "running");
    return r.length >= n && r;
  });
const job = (mealId: string) =>
  s.repos.jobs.list({ type: "analyse" }).filter((j) => j.type === "analyse" && j.payload.mealId === mealId);
const runDir = (runId: string) => join(dataPaths(s.dataDir).runs, runId);
const fakeRecord = (runId: string) =>
  JSON.parse(readFileSync(join(runDir(runId), "fake-agent.json"), "utf8")) as Record<string, unknown>;
const trace = (runId: string): TraceEntry[] =>
  readFileSync(join(runDir(runId), "trace.ndjson"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
/** Make the job's retry due now instead of after the backoff. */
const retryNow = (mealId: string) =>
  s.repos.db
    .query("UPDATE jobs SET run_after = 0 WHERE status = 'queued' AND payload LIKE ?")
    .run(`%${mealId}%`);

describe("analysis run lifecycle", () => {
  test("success: one revision linked to its run, the meal analysed, a full trace", async () => {
    const mealId = meal("Porridge mit Blaubeeren, fake:save");
    s.meals.analyse(mealId);
    const m = await settledMeal(mealId, "analysed");
    const [run] = await finishedRun(mealId);
    expect(run).toMatchObject({
      status: "succeeded",
      harness: "custom",
      model: "fake-smart-answered", // as reported by the harness, after set_config_option
      attempt: 1,
      stopReason: "end_turn",
      error: null,
      revisionId: m.currentRevisionId,
    });
    expect(run!.usage).toEqual({
      turn: { totalTokens: 1500, inputTokens: 1200, outputTokens: 300 },
      context: { used: 1000, size: 200_000, cost: null },
    });
    const revision = s.repos.revisions.get(m.currentRevisionId!)!;
    expect(revision).toMatchObject({ runId: run!.id, title: "Testessen", status: "analysed" });
    expect(job(mealId).map((j) => j.status)).toEqual(["done"]);

    // the session: skill appended as system prompt, model via config option, the yamt server
    const rec = fakeRecord(run!.id);
    expect(rec.systemPromptMode).toBe("append");
    expect(rec.systemPrompt).toContain("# Log a meal");
    expect(rec.systemPrompt).not.toContain("name: log-meal"); // frontmatter stripped
    expect(rec.model).toBe("fake-smart");
    expect(rec.cwd).toBe(runDir(run!.id));
    expect(rec.mcpServers).toEqual([{ name: "yamt", url: app.mcpUrl, headers: ["Authorization"] }]);
    const prompt = rec.prompt as { type: string; text?: string }[];
    expect(prompt[0]?.text).toContain(`Analyse meal ${mealId}`);
    expect(prompt[0]?.text).toContain("exactly one save_meal_revision");

    // trace: every step, the token redacted, private file
    const entries = trace(run!.id);
    const kinds = new Set(entries.map((e) => e.kind));
    for (const k of [
      "run.start",
      "process.start",
      "initialize",
      "session.new",
      "config",
      "prompt",
      "update",
    ]) {
      expect(kinds.has(k)).toBe(true);
    }
    expect(entries.map((e) => e.kind).slice(-3)).toEqual(["prompt.end", "process.exit", "run.end"]);
    expect(entries.filter((e) => e.kind === "update").length).toBeGreaterThan(3);
    const raw = readFileSync(join(runDir(run!.id), "trace.ndjson"), "utf8");
    expect(raw).not.toMatch(/yamt_[A-Za-z0-9_-]{20,}/);
    expect(raw).toContain("Bearer [redacted]");
    expect(statSync(join(runDir(run!.id), "trace.ndjson")).mode & 0o777).toBe(0o600);
    expect(statSync(runDir(run!.id)).mode & 0o777).toBe(0o700);

    // the API: runs on the meal, the run, its trace
    const detail = (await (
      await fetch(new URL(mealPaths.meal(mealId), app.localUrl))
    ).json()) as MealDetailResponse;
    expect(detail.runs.map((r) => r.id)).toEqual([run!.id]);
    expect(detail.revision?.revision.runId).toBe(run!.id);
    const one = (await (await fetch(new URL(runPaths.run(run!.id), app.localUrl))).json()) as RunResponse;
    expect(one.run.id).toBe(run!.id);
    const res = await fetch(new URL(runPaths.trace(run!.id), app.localUrl));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect((await res.text()).trim().split("\n").length).toBe(entries.length);
    expect((await fetch(new URL(runPaths.trace(newId()), app.localUrl))).status).toBe(404);
  });

  test("needs_input: a revision with a question", async () => {
    const mealId = meal("Bratkartoffeln, fake:question");
    s.meals.analyse(mealId);
    const m = await settledMeal(mealId, "needs_input");
    const [run] = await finishedRun(mealId);
    expect(run?.status).toBe("succeeded");
    const view = s.revisions.view(m.currentRevisionId!)!;
    expect(view.questions.map((q) => q.impactKcal)).toEqual([120]);
  });

  test("a turn that ends without save_meal_revision fails the attempt; the retries back off; then failed; analyse retries", async () => {
    const mealId = meal("fake:nosave");
    const before = Date.now();
    s.meals.analyse(mealId);
    const [first] = await finishedRun(mealId);
    expect(first).toMatchObject({ status: "failed", stopReason: "end_turn", revisionId: null });
    expect(first!.error).toContain("without calling save_meal_revision");
    expect(first!.error).toContain("Ich kann dieses Essen nicht einschätzen.");
    await settledMeal(mealId, "queued");
    const [queued] = job(mealId);
    expect(queued).toMatchObject({ status: "queued", attempts: 1 });
    expect(queued!.runAfter).toBeGreaterThanOrEqual(before + 30_000);

    retryNow(mealId);
    await finishedRun(mealId, 2);
    await waitFor(
      "second retry queued",
      () => job(mealId)[0]?.status === "queued" && job(mealId)[0]?.attempts === 2,
    );
    retryNow(mealId);
    const failed = await settledMeal(mealId, "failed");
    expect(failed.analysisError).toContain("without calling save_meal_revision");
    expect(runs(mealId).map((r) => r.attempt)).toEqual([3, 2, 1]);
    expect(job(mealId)[0]).toMatchObject({ status: "failed", attempts: 3 });

    // the retry endpoint: a fresh job; with the script corrected, it goes through
    const nosave = s.repos.captures.listForMeal(mealId)[0]!;
    s.meals.retract(nosave.id);
    s.meals.addJson(mealId, { kind: "text", text: "fake:save" });
    const res = await fetch(new URL(mealPaths.analyse(mealId), app.localUrl), {
      method: "POST",
      headers: { Origin: new URL(app.localUrl).origin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meal: { status: string; analysisError: string | null } };
    expect(body.meal).toMatchObject({ status: "queued", analysisError: null });
    const done = await settledMeal(mealId, "analysed");
    expect(done.analysisError).toBeNull();
    const [latest] = await finishedRun(mealId, 4);
    expect(latest).toMatchObject({ status: "succeeded", attempt: 1 });
  });

  test("an agent crash fails the attempt with the exit and stderr", async () => {
    const mealId = meal("fake:crash");
    s.meals.analyse(mealId);
    const [run] = await finishedRun(mealId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/^harness exited \(code 3\)/);
    await settledMeal(mealId, "queued");
    expect(trace(run!.id).find((e) => e.kind === "process.exit")).toMatchObject({ code: 3 });
  });

  test("a silent agent times out, is cancelled and stopped", async () => {
    const mealId = meal("fake:hang");
    s.meals.analyse(mealId);
    const [run] = await finishedRun(mealId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("no response from the harness for 1500 ms");
    const kinds = trace(run!.id).map((e) => e.kind);
    expect(kinds).toContain("cancel");
    expect(kinds.at(-1)).toBe("run.end");
    await settledMeal(mealId, "queued");
  });

  test("a second save in the same run is refused; the run keeps its one revision", async () => {
    const mealId = meal("fake:twice");
    s.meals.analyse(mealId);
    await settledMeal(mealId, "analysed");
    const [run] = await finishedRun(mealId);
    expect(run?.status).toBe("succeeded");
    expect(s.repos.revisions.listForMeal(mealId)).toHaveLength(1);
    const second = fakeRecord(run!.id).secondSave as { isError: boolean; text: string };
    expect(second.isError).toBe(true);
    expect(second.text).toContain("already saved revision 1");
  });

  test("permissions: yamt tools, web fetch and the meal's photos are allowed; shell, edits and other files are not", async () => {
    const mealId = meal("fake:permissions");
    await s.meals.addUpload(
      mealId,
      new File([fixture("gradient.jpg")], "plate.jpg", { type: "image/jpeg" }),
      {},
    );
    s.meals.analyse(mealId);
    await settledMeal(mealId, "analysed");
    const [run] = await finishedRun(mealId);
    expect(fakeRecord(run!.id).permissions).toEqual({
      "rm -rf /": "no",
      "Edit notes.md": "no",
      "Fetch example.org": "yes",
      "Read photo": "yes",
      "Read /etc/hostname": "no",
    });
    // the photo went along as an image block (the fake agent advertises image prompts)
    const prompt = fakeRecord(run!.id).prompt as { type: string; text?: string }[];
    expect(prompt.filter((b) => b.type === "image") as unknown[]).toEqual([
      { type: "image", mimeType: "image/jpeg", bytes: fixture("gradient.jpg").length },
    ]);
    expect(prompt.some((b) => b.text?.startsWith("Photo "))).toBe(true);
    const perms = trace(run!.id).filter((e) => e.kind === "permission");
    expect(perms.map((p) => p.decision)).toEqual(["reject", "reject", "allow", "allow", "reject"]);
  });
});

describe("log again (#30)", () => {
  test("a copy runs nothing; once a capture arrives, re-analysis starts from the copied revision", async () => {
    const sourceId = meal("Cappuccino, fake:save");
    s.meals.analyse(sourceId);
    await settledMeal(sourceId, "analysed");
    const { meal: copy, revision } = s.meals.repeat(sourceId, { factor: 2, eatenAt: Date.now() });
    expect(copy.status).toBe("analysed");
    expect(() => s.meals.analyse(copy.id)).toThrow("nothing to analyse yet");
    await Bun.sleep(100);
    expect(runs(copy.id)).toEqual([]);

    s.meals.addJson(copy.id, { kind: "text", text: "Diesmal mit Hafermilch, fake:save" });
    s.meals.analyse(copy.id);
    const m = await settledMeal(copy.id, "analysed");
    const [run] = await finishedRun(copy.id);
    expect(run?.status).toBe("succeeded");
    expect(s.repos.revisions.listForMeal(copy.id).map((r) => [r.number, r.kind, r.runId])).toEqual([
      [1, "copy", null],
      [2, "analysis", run!.id],
    ]);
    expect(m).toMatchObject({ currentRevisionId: run!.revisionId, eatenAtSource: "user" });
    const rec = fakeRecord(run!.id);
    expect(rec.currentRevision).toEqual({ number: revision.revision.number, kind: "copy" });
    const prompt = rec.prompt as { text?: string }[];
    expect(prompt[0]?.text).toContain("This is a re-analysis: revision 1 exists");
  });
});

describe("transcripts", () => {
  /** An audio capture with a pending transcript, as an upload would make it. */
  function audio(mealId: string) {
    const id = newId();
    s.repos.db.transaction(() => {
      s.repos.captures.insert({
        id,
        mealId,
        kind: "audio",
        media: {
          mimeType: "audio/mp4",
          path: `media/2026/11/${id}.m4a`,
          byteSize: 10,
          sha256: "0",
          fileName: null,
        },
      });
      s.repos.transcripts.upsertPending(id);
      s.repos.meals.capturesChanged(mealId);
    })();
    return id;
  }

  test("an analysis waits for pending transcripts without spending attempts, then runs", async () => {
    const mealId = meal("fake:save");
    const memo = audio(mealId);
    s.meals.analyse(mealId);
    await waitFor("a few reschedules", () => (job(mealId)[0]?.lastError ?? "").includes("transcript"));
    await Bun.sleep(200);
    expect(runs(mealId)).toEqual([]);
    expect(status(mealId)).toBe("queued");
    expect(job(mealId)[0]).toMatchObject({ status: "queued", attempts: 0 });

    s.repos.transcripts.complete(memo, {
      text: "Haferflocken mit Milch",
      model: "test",
      language: "de",
      durationMs: 3000,
      segments: null,
    });
    await settledMeal(mealId, "analysed");
    const [run] = await finishedRun(mealId);
    expect(job(mealId)[0]).toMatchObject({ status: "done", attempts: 1 });
    expect(fakeRecord(run!.id).captureKinds).toEqual(["text", "audio"]);
  });

  test("a failed transcript doesn't block; the prompt mentions it", async () => {
    const mealId = meal("fake:save");
    const memo = audio(mealId);
    s.repos.transcripts.fail(memo, "decoder error");
    s.meals.analyse(mealId);
    await settledMeal(mealId, "analysed");
    const [run] = await finishedRun(mealId);
    const prompt = fakeRecord(run!.id).prompt as { text?: string }[];
    expect(prompt[0]?.text).toContain(`Voice memo ${memo} could not be transcribed (decoder error)`);
  });
});

describe("concurrency", () => {
  const overlap = (a: AnalysisRun, b: AnalysisRun) => a.startedAt < b.endedAt! && b.startedAt < a.endedAt!;

  test("one analysis at a time across meals", async () => {
    const a = meal("fake:slow:400");
    const b = meal("fake:slow:400");
    s.meals.analyse(a);
    s.meals.analyse(b);
    await settledMeal(a, "analysed");
    await settledMeal(b, "analysed");
    const [ra] = await finishedRun(a);
    const [rb] = await finishedRun(b);
    expect(overlap(ra!, rb!)).toBe(false);
  });

  test("analyse during a run queues a second run behind it; the meal stays queued in between", async () => {
    const mealId = meal("fake:slow:400");
    s.meals.analyse(mealId);
    await waitFor("the first run", () => status(mealId) === "analysing");
    expect(s.meals.analyse(mealId).meal.status).toBe("queued");
    expect(s.repos.jobs.hasQueued(dedupeKeys.analyse(mealId))).toBe(true);
    await waitFor("the first revision", () => s.repos.revisions.listForMeal(mealId).length === 1);
    expect(["queued", "analysing"]).toContain(status(mealId)); // not analysed: another run is due
    await waitFor("the second revision", () => s.repos.revisions.listForMeal(mealId).length === 2);
    await settledMeal(mealId, "analysed");
    const [second, first] = await finishedRun(mealId, 2);
    expect(overlap(first!, second!)).toBe(false);
    // the second run started from the first revision
    const prompt = fakeRecord(second!.id).prompt as { text?: string }[];
    expect(prompt[0]?.text).toContain("re-analysis: revision 1 exists");
  });
});

describe("server lifecycle", () => {
  test("stopping the server cancels a run and queues it again without spending an attempt", async () => {
    const dir = join(tempDir(), "data");
    const other: AppServer = start(dir);
    const o = other.services;
    const m = o.meals.create({});
    o.meals.addJson(m.id, { kind: "text", text: "fake:slow:20000" });
    o.meals.analyse(m.id);
    await waitFor("the run", () => o.repos.meals.get(m.id)?.status === "analysing");
    await Bun.sleep(300);
    await other.stop();

    const again = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    try {
      const r = again.services.repos;
      expect(r.runs.listForMeal(m.id)[0]).toMatchObject({ status: "cancelled" });
      expect(r.meals.get(m.id)?.status).toBe("queued");
      expect(r.jobs.list({ type: "analyse" })[0]).toMatchObject({ status: "queued", attempts: 0 });
    } finally {
      await again.stop();
    }
  });

  test("after a crash, the next start fails the interrupted run and requeues its meal", async () => {
    const dir = join(tempDir(), "data");
    const first = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    const r1 = first.services.repos;
    const m = first.services.meals.create({});
    first.services.meals.addJson(m.id, { kind: "text", text: "Brot" });
    first.services.meals.analyse(m.id);
    // what a crash mid-run leaves: a running job and run, the meal analysing
    const claimed = r1.jobs.claim({ types: ["analyse"] })!;
    r1.runs.insert({
      id: newId(),
      mealId: m.id,
      jobId: claimed.id,
      attempt: 1,
      harness: "custom",
      model: null,
      effort: null,
      startedAt: Date.now(),
    });
    r1.meals.setStatus(m.id, "analysing");
    await first.stop();

    const second = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    try {
      const r = second.services.repos;
      expect(r.runs.listForMeal(m.id)[0]).toMatchObject({
        status: "failed",
        error: expect.stringContaining("interrupted"),
      });
      expect(r.meals.get(m.id)?.status).toBe("queued");
      expect(r.jobs.list({ type: "analyse" })[0]).toMatchObject({ status: "queued", attempts: 1 });
    } finally {
      await second.stop();
    }
  });

  test("without a system prompt capability the skill goes as a preamble; without image support photos are listed", async () => {
    const other = start(join(tempDir(), "data"), { FAKE_ACP_NO_SYSTEM_PROMPT: "1" });
    try {
      const o = other.services;
      const m = o.meals.create({});
      o.meals.addJson(m.id, { kind: "text", text: "fake:save" });
      const photo = await o.meals.addUpload(m.id, new File([fixture("gradient.heic")], "p.heic"), {});
      o.meals.analyse(m.id);
      await waitFor("analysed", () => o.repos.meals.get(m.id)?.status === "analysed");
      // the agent rewrites its record after save_meal_revision: read it once the run has ended
      const run = await waitFor("the run ended", () =>
        o.repos.runs.listForMeal(m.id).find((r) => r.status !== "running"),
      );
      const rec = JSON.parse(
        readFileSync(join(dataPaths(o.dataDir).runs, run.id, "fake-agent.json"), "utf8"),
      ) as { systemPrompt: string; prompt: { type: string; text?: string }[] };
      expect(rec.systemPrompt).toBe("");
      expect(rec.prompt[0]?.text).toStartWith("<system-instructions>\n# Log a meal");
      expect(rec.prompt.some((b) => b.type === "image")).toBe(false);
      // the HEIC photo is offered through its JPEG derivative's path
      const listed = rec.prompt[1]?.text ?? "";
      expect(listed).toContain(`capture ${photo.capture.id}`);
      expect(listed).toMatch(/\/media\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg/);
      expect(existsSync(dataPaths(o.dataDir).media)).toBe(true);
      expect(readdirSync(dataPaths(o.dataDir).runs)).toEqual([run.id]);
    } finally {
      await other.stop();
    }
  });
});
