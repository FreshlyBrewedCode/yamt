import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDays,
  type PlanningRunResponse,
  type PlanningSuggestion,
  runPaths,
  type TraceEntry,
} from "@yamt/shared";
import { dataPaths } from "../src/config.ts";
import { newId } from "../src/db/index.ts";
import { dedupeKeys } from "../src/db/repos/jobs.ts";
import { DIDNT_COMPLETE, REQUEST_ARCHIVED } from "../src/domain/planning-requests.ts";
import { localDate } from "../src/domain/time.ts";
import { PLAN_TURN_MAX_MS, planTurnMs } from "../src/planning/job.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { fakeAgentConfig, fakePlanningConfig, tempDir } from "./helpers.ts";
import { fixtureFetch } from "./nutrition-fixtures.ts";

setDefaultTimeout(30_000);
const TZ = "Europe/Berlin";

function start(dataDir = join(tempDir(), "data")) {
  return createServer({
    dataDir,
    port: 0,
    webDist: null,
    auth: { kind: "off" },
    timeZone: TZ,
    fetch: fixtureFetch(),
    fdcApiKey: "test-key",
    worker: { pollMs: 20 },
    analysis: { config: fakeAgentConfig() },
    planning: {
      config: fakePlanningConfig({ model: "fake-smart", effort: "high" }),
      timeouts: { idleMs: 1500, toolIdleMs: 1500, turnMs: 10_000, cancelGraceMs: 300 },
      transcriptWaitMs: 50,
    },
  });
}

const app = start();
const s = app.services;
const servers: AppServer[] = [app];
afterAll(() => Promise.all(servers.map((x) => x.stop())));

async function waitFor<T>(what: string, fn: () => T | null | undefined | false, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

const today = () => localDate(Date.now(), TZ);

/** A request with a `fake:` text (it scripts the fake agent) and its first round, queued. */
function round(text = "fake:plan", filters: Record<string, unknown> = {}) {
  const { request } = s.planningRequests.create({ filters, text, tz: TZ });
  const { round, jobId } = s.planningRequests.suggest(request.id);
  return { request, round, jobId };
}
const roundNow = (id: string) => s.repos.planningRounds.get(id)!;
const settled = (id: string, ...statuses: string[]) =>
  waitFor(`round ${statuses.join("/")}`, () => statuses.includes(roundNow(id).status) && roundNow(id));
const suggestions = (id: string): PlanningSuggestion[] => s.repos.planningRounds.suggestions(id);
const runs = (id: string) => s.repos.planningRuns.listForRound(id);
const runDir = (runId: string) => join(dataPaths(s.dataDir).runs, runId);
const fakeRecord = (runId: string) =>
  JSON.parse(readFileSync(join(runDir(runId), "fake-agent.json"), "utf8")) as Record<string, unknown>;
const job = (jobId: string) => s.repos.jobs.get(jobId)!;
/** Make the job's retry due now instead of after the backoff. */
const retryNow = (jobId: string) =>
  s.repos.db.query("UPDATE jobs SET run_after = 0 WHERE id = ? AND status = 'queued'").run(jobId);

describe("the plan job's verdicts", () => {
  test("done: an outline, then every suggestion ready; the run with its trace, the skill and the planning agent", async () => {
    const {
      request,
      round: r,
      jobId,
    } = round("Zwei Abendessen, fake:plan", {
      days: [today(), addDays(today(), 1)],
      count: 2,
      portionsCooked: 2,
    });
    const done = await settled(r.id, "done", "failed");
    expect(done).toMatchObject({ status: "done", error: null });
    expect(job(jobId)).toMatchObject({ status: "done", attempts: 1 });
    const ready = suggestions(r.id);
    expect(ready.map((x) => [x.position, x.status, x.title, x.proposedDate, x.proposedSlot])).toEqual([
      [0, "ready", "Linsen-Dal mit Spinat", today(), "dinner"],
      [1, "ready", "Hähnchen-Gemüse-Pfanne", addDays(today(), 1), "dinner"],
    ]);
    // each is an insert-only recipe with the request's portions; code computed its numbers
    const recipe = s.recipes.get(ready[0]!.recipeId!);
    expect(recipe.recipe).toMatchObject({ servings: 2, sourceMode: "adapted", changes: ["Sahne → Joghurt"] });
    expect(recipe.perPortion.nutrients.energyKcal).toBe(Math.round((350 * 120 + 30 * 300) / 100 / 2));

    const [run] = runs(r.id);
    expect(done.runId).toBe(run!.id);
    expect(run).toMatchObject({
      status: "succeeded",
      harness: "custom",
      requestedModel: "fake-smart",
      model: "fake-smart-answered",
      requestedEffort: "high",
      effort: "high",
      attempt: 1,
      ready: 2,
      error: null,
    });
    // the session: the plan-meals skill appended, the round in the prompt, the yamt server
    const rec = fakeRecord(run!.id);
    expect(rec.systemPromptMode).toBe("append");
    expect(rec.systemPrompt).toContain("# Plan meals");
    expect(rec.systemPrompt).not.toContain("name: plan-meals");
    expect(rec.model).toBe("fake-smart");
    expect(rec.effort).toBe("high");
    expect(rec.mcpServers).toEqual([{ name: "yamt", url: app.mcpUrl, headers: ["Authorization"] }]);
    const prompt = (rec.prompt as { text?: string }[])[0]!.text!;
    expect(prompt).toContain(`Planning round ${r.id}: round 1 of the planning request "${request.title}"`);
    expect(prompt).toContain("attempt 1 of 3");
    expect(prompt).toContain("save_round_outline with exactly 2 ideas");
    expect((rec.plan as { days: string[] }).days).toEqual([today(), addDays(today(), 1)]);

    // the trace: the token redacted; served by the runs route like an analysis's
    const raw = readFileSync(join(runDir(run!.id), "trace.ndjson"), "utf8");
    expect(raw).not.toMatch(/Bearer yamt_/);
    expect(raw).toContain("Bearer [redacted]");
    const entries = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as TraceEntry);
    expect(entries[0]).toMatchObject({ kind: "run.start", roundId: r.id, attempt: 1 });
    expect(entries.at(-1)).toMatchObject({
      kind: "run.end",
      status: "succeeded",
      ready: 2,
      roundStatus: "done",
    });
    const res = await fetch(new URL(runPaths.trace(run!.id), app.localUrl));
    expect(res.status).toBe(200);
    const view = (await (
      await fetch(new URL(runPaths.planningRun(run!.id), app.localUrl))
    ).json()) as PlanningRunResponse;
    expect(view.run).toMatchObject({ id: run!.id, roundId: r.id, ready: 2 });
  });

  test("partial: one ready, one failed by the agent, the rest didn't complete; the round is done", async () => {
    const { round: r, jobId } = round("fake:plan-partial");
    await settled(r.id, "done", "failed");
    expect(roundNow(r.id).status).toBe("done");
    expect(suggestions(r.id).map((x) => [x.status, x.failure])).toEqual([
      ["ready", null],
      ["failed", "Kein passendes Rezept gefunden."],
      ["failed", DIDNT_COMPLETE],
    ]);
    expect(job(jobId).status).toBe("done");
  });

  test("a crash after one save still counts: done with what was saved", async () => {
    const { round: r } = round("fake:plan-crash");
    await settled(r.id, "done", "failed");
    expect(suggestions(r.id).map((x) => x.status)).toEqual(["ready", "failed", "failed"]);
    const [run] = runs(r.id);
    expect(run).toMatchObject({ status: "succeeded", ready: 1 });
    expect(run!.error).toMatch(/^after saving 1 suggestion: /);
  });

  test("retry: an attempt without a ready suggestion requeues the round; the next outline replaces it", async () => {
    const { round: r, jobId } = round("fake:plan-once");
    await waitFor("attempt 1 failed", () => job(jobId).attempts === 1 && job(jobId).status === "queued");
    const queued = await settled(r.id, "queued");
    expect(queued.error).toMatch(
      /^the agent ended its turn without saving a suggestion \(end_turn\); it said: "Mir fällt/,
    );
    const first = suggestions(r.id);
    expect(first.map((x) => x.status)).toEqual(["outlined", "outlined", "outlined"]);
    // the backoff: 30 s after the first attempt
    expect(job(jobId).runAfter).toBeGreaterThan(Date.now() + 20_000);
    retryNow(jobId);
    await settled(r.id, "done");
    const second = suggestions(r.id);
    expect(second.map((x) => x.status)).toEqual(["ready", "ready", "ready"]);
    expect(second.map((x) => x.id)).not.toEqual(first.map((x) => x.id));
    expect(runs(r.id).map((x) => [x.attempt, x.status])).toEqual([
      [2, "succeeded"],
      [1, "failed"],
    ]);
    const prompt = (fakeRecord(runs(r.id)[0]!.id).prompt as { text?: string }[])[0]!.text!;
    expect(prompt).toContain("attempt 2 of 3");
    expect(prompt).toContain("save the outline again");
  });

  test("failed: three attempts without a suggestion, then the round fails with the reason", async () => {
    const { round: r, jobId } = round("fake:plan-none");
    for (const n of [1, 2]) {
      await waitFor(`attempt ${n}`, () => job(jobId).attempts === n && job(jobId).status === "queued");
      retryNow(jobId);
    }
    const failed = await settled(r.id, "failed");
    expect(job(jobId)).toMatchObject({ status: "failed", attempts: 3 });
    expect(failed.error).toMatch(/^the agent ended its turn without saving a suggestion/);
    expect(suggestions(r.id).every((x) => x.status === "failed")).toBe(true);
    expect(runs(r.id).map((x) => x.status)).toEqual(["failed", "failed", "failed"]);
  });

  test("a missing login fails at once, without retries", async () => {
    const { round: r, jobId } = round("fake:plan-auth");
    const failed = await settled(r.id, "failed");
    expect(job(jobId)).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.error).toContain("Not logged in");
  });

  test("cancelled: archiving the request stops the run; its token stops working; nothing more is saved", async () => {
    const { request, round: r, jobId } = round("fake:plan-slow:3000");
    const running = await settled(r.id, "running");
    await waitFor("the outline", () => suggestions(r.id).length === 3);
    s.planningRequests.archive(request.id);
    // the archive failed the round at once, the run winds down
    expect(roundNow(r.id)).toMatchObject({ status: "failed", error: REQUEST_ARCHIVED });
    await waitFor("the job cancelled", () => job(jobId).status === "cancelled");
    expect(job(jobId).lastError).toBe(REQUEST_ARCHIVED);
    const run = await waitFor("the run ended", () => {
      const x = s.repos.planningRuns.get(running.runId!);
      return x?.status !== "running" && x;
    });
    expect(run).toMatchObject({ status: "cancelled", ready: 0, error: `cancelled: ${REQUEST_ARCHIVED}` });
    expect(suggestions(r.id).map((x) => [x.status, x.failure])).toEqual([
      ["failed", DIDNT_COMPLETE],
      ["failed", DIDNT_COMPLETE],
      ["failed", DIDNT_COMPLETE],
    ]);
  });

  test("matched ingredients: the fixtures' Open Food Facts and USDA foods end up in the recipe", async () => {
    const { round: r } = round("fake:plan-match", { count: 1 });
    await settled(r.id, "done", "failed");
    const [x] = suggestions(r.id);
    expect(x!.status).toBe("ready");
    const recipe = s.recipes.get(x!.recipeId!);
    expect(recipe.items.map((i) => [i.description, i.food?.source, i.provenance])).toEqual([
      ["300 g Skyr", "off", "database"],
      ["80 g Haferflocken", "fdc", "database"],
    ]);
    const match = (fakeRecord(runs(r.id)[0]!.id).plan as { match: { text: string } }).match;
    const out = JSON.parse(match.text) as { ingredients: { asked: string[] }[]; fitToSlot?: unknown };
    expect(out.ingredients.map((i) => i.asked)).toEqual([
      ["history", "cache", "off"],
      ["history", "cache", "fdc"],
    ]);
  });
});

describe("waiting, stopping and restarting", () => {
  test("a voice input's pending transcript holds the round without spending attempts", async () => {
    const { request } = s.planningRequests.create({ filters: {}, text: "fake:plan", tz: TZ });
    const voice = newId();
    s.repos.planningInputs.insert({ id: voice, requestId: request.id, kind: "audio", now: Date.now() });
    s.repos.planningTranscripts.upsertPending(voice);
    const { round: r, jobId } = s.planningRequests.suggest(request.id);
    await waitFor("a reschedule", () => job(jobId).lastError?.startsWith("waiting for"));
    expect(job(jobId)).toMatchObject({ status: "queued", attempts: 0 });
    expect(roundNow(r.id).status).toBe("queued");
    s.repos.planningTranscripts.complete(voice, {
      text: "Etwas mit Linsen.",
      model: "fake",
      language: "de",
      durationMs: 1000,
      segments: null,
    });
    s.repos.jobs.expedite(dedupeKeys.plan(request.id));
    await settled(r.id, "done");
    expect(job(jobId).attempts).toBe(1);
  });

  test("a server stop requeues the round without spending an attempt; the next start keeps what is ready", async () => {
    const dir = join(tempDir(), "data");
    const first = start(dir);
    const { request } = first.services.planningRequests.create({
      filters: {},
      text: "fake:plan-slow:600",
      tz: TZ,
    });
    const { round: r, jobId } = first.services.planningRequests.suggest(request.id);
    await waitFor("one ready", () =>
      first.services.repos.planningRounds.suggestions(r.id).some((x) => x.status === "ready"),
    );
    await first.stop();
    const db = (await import("../src/db/index.ts")).openDb(join(dir, "yamt.db"));
    const repos = (await import("../src/db/repos/index.ts")).createRepos(db);
    expect(repos.jobs.get(jobId)).toMatchObject({ status: "queued", attempts: 0 });
    expect(repos.planningRounds.get(r.id)).toMatchObject({ status: "queued" });
    expect(repos.planningRuns.listForRound(r.id)[0]).toMatchObject({ status: "cancelled" });
    db.close();

    const second = start(dir);
    servers.push(second);
    await waitFor("done", () => second.services.repos.planningRounds.get(r.id)?.status === "done");
    const all = second.services.repos.planningRounds.suggestions(r.id);
    expect(all.every((x) => x.status === "ready")).toBe(true);
    const prompt = (
      JSON.parse(
        readFileSync(
          join(
            dataPaths(dir).runs,
            second.services.repos.planningRuns.listForRound(r.id)[0]!.id,
            "fake-agent.json",
          ),
          "utf8",
        ),
      ).prompt as { text: string }[]
    )[0]!.text;
    expect(prompt).toContain("keep its outline (don't save a new one)");
  });

  test("after a crash, the next start fails the interrupted run and requeues its round (an attempt spent)", async () => {
    const dir = join(tempDir(), "data");
    const before = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    const ps = before.services;
    const { request } = ps.planningRequests.create({ filters: {}, text: "fake:plan" });
    const { round: r, jobId } = ps.planningRequests.suggest(request.id);
    // as a crashed process leaves it: the job claimed, the run and the round running
    ps.repos.jobs.claim({ types: ["plan"] });
    const runId = newId();
    ps.repos.planningRuns.insert({
      id: runId,
      roundId: r.id,
      jobId,
      attempt: 1,
      harness: "custom",
      model: null,
      effort: null,
      startedAt: Date.now(),
    });
    ps.planningRequests.startRound(r.id, runId);
    await before.stop();

    const after = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    servers.push(after);
    const as = after.services;
    expect(as.repos.jobs.get(jobId)).toMatchObject({ status: "queued", attempts: 1 });
    expect(as.repos.planningRounds.get(r.id)).toMatchObject({
      status: "queued",
      error: "interrupted: the server stopped while it ran",
    });
    expect(as.repos.planningRuns.get(runId)).toMatchObject({ status: "failed" });
  });

  test("the turn's cap: 2 min per suggestion plus 1, at most 15", () => {
    expect(planTurnMs(1)).toBe(3 * 60_000);
    expect(planTurnMs(3)).toBe(7 * 60_000);
    expect(planTurnMs(6)).toBe(13 * 60_000);
    expect(planTurnMs(9)).toBe(PLAN_TURN_MAX_MS);
  });
});
