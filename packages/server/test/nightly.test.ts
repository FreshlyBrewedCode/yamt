import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_PLANNING_SETTINGS,
  type NightlyResponse,
  type NightlySettings,
  planningNightlyPaths,
  planningSettingsPaths,
  type RegenerateNightlyResponse,
} from "@yamt/shared";
import { dedupeKeys } from "../src/db/repos/jobs.ts";
import { localTimeAt, NIGHTLY_OFF, nextNightlyRun } from "../src/domain/nightly.ts";
import { PLANNING_SETTINGS_KEY } from "../src/domain/planning-settings.ts";
import { isoLocal, localDate } from "../src/domain/time.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { fakeAgentConfig, fakePlanningConfig, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);
const TZ = "Europe/Berlin";

describe("when the nightly run is due", () => {
  test("HH:MM on a date in the zone, DST-safe", () => {
    expect(isoLocal(localTimeAt("2026-11-06", "03:00", TZ), TZ)).toBe("2026-11-06T03:00:00+01:00");
    expect(isoLocal(localTimeAt("2026-07-01", "03:00", TZ), TZ)).toBe("2026-07-01T03:00:00+02:00");
    // the day clocks go back (03:00 CEST → 02:00 CET) and forward (02:00 → 03:00)
    expect(isoLocal(localTimeAt("2026-10-25", "03:00", TZ), TZ)).toBe("2026-10-25T03:00:00+01:00");
    expect(isoLocal(localTimeAt("2026-03-29", "03:00", TZ), TZ)).toBe("2026-03-29T03:00:00+02:00");
    expect(isoLocal(localTimeAt("2026-03-29", "23:30", TZ), TZ)).toBe("2026-03-29T23:30:00+02:00");
  });

  test("today's time while it is ahead, else tomorrow's; never on a day that had its run", () => {
    const at = (iso: string) => new Date(iso).getTime();
    const next = (now: string, skip: string | null = null, time = "03:00") =>
      isoLocal(nextNightlyRun(time, TZ, at(now), skip), TZ);
    expect(next("2026-11-06T01:00:00+01:00")).toBe("2026-11-06T03:00:00+01:00");
    expect(next("2026-11-06T03:00:00+01:00")).toBe("2026-11-07T03:00:00+01:00");
    expect(next("2026-11-06T10:00:00+01:00", null, "18:30")).toBe("2026-11-06T18:30:00+01:00");
    // regenerated at 01:00 already: today's run is skipped
    expect(next("2026-11-06T01:00:00+01:00", "2026-11-06")).toBe("2026-11-07T03:00:00+01:00");
    // after midnight in the zone, not in UTC
    expect(next("2026-11-06T23:30:00Z", null, "02:00")).toBe("2026-11-07T02:00:00+01:00");
  });
});

function start(dataDir = join(tempDir(), "data")) {
  return createServer({
    dataDir,
    port: 0,
    webDist: null,
    auth: { kind: "off" },
    timeZone: TZ,
    worker: { pollMs: 20 },
    // nightly rounds take a moment, so an earlier one is still seen open while a new one runs
    analysis: { config: fakeAgentConfig({ FAKE_ACP_NIGHTLY: "plan-slow:300" }) },
    planning: {
      config: fakePlanningConfig(),
      timeouts: { idleMs: 1500, toolIdleMs: 1500, turnMs: 10_000, cancelGraceMs: 300 },
    },
  });
}

const servers: AppServer[] = [];
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

describe("the nightly run", () => {
  const app = start();
  servers.push(app);
  const s = app.services;
  const origin = new URL(app.localUrl).origin;
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(new URL(path, app.localUrl), {
      method,
      headers: { Origin: origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const setNightly = (nightly: Partial<NightlySettings>) =>
    call("PUT", planningSettingsPaths.settings, {
      ...DEFAULT_PLANNING_SETTINGS,
      nightly: { ...DEFAULT_PLANNING_SETTINGS.nightly, ...nightly },
    });
  const queued = () => s.repos.jobs.queued(dedupeKeys.nightly);
  const nightlies = () => s.repos.planningRequests.listOpenOf("nightly");
  const today = () => localDate(Date.now(), TZ);
  const doneRound = (requestId: string) =>
    waitFor("the nightly round done", () => {
      const r = s.repos.planningRounds.listForRequest(requestId)[0];
      return r && (r.status === "done" || r.status === "failed") && r;
    });
  /** Today's main slots planned, so nothing is open. */
  const planEverything = () => {
    const recipe = s.recipes.save({
      title: "Testessen",
      summary: "",
      sourceMode: "composed",
      servings: 1,
      timeTotalMin: 10,
      steps: ["Kochen."],
      items: [
        {
          description: "100 g Testgericht",
          grams: 100,
          estimatePer100g: { energyKcal: 150, protein: 10, fat: 5, carbohydrate: 15 },
          provenance: "estimate",
          confidence: "low",
        },
      ],
    });
    return (["breakfast", "lunch", "dinner"] as const).map(
      (slot) => s.planning.create({ recipeId: recipe.recipe.id, date: today(), slot }).plannedMeal.id,
    );
  };

  beforeEach(() => {
    // each test starts with no nightly request open and the run off
    for (const r of nightlies()) s.planningRequests.archive(r.id);
    s.repos.settings.set(PLANNING_SETTINGS_KEY, DEFAULT_PLANNING_SETTINGS);
    s.nightly.schedule();
  });

  test("scheduled only while on, at the next time; a new time replaces it; off cancels it", async () => {
    expect(queued()).toBeNull();
    expect((await call<NightlyResponse>("GET", planningNightlyPaths.nightly)).body).toMatchObject({
      settings: { enabled: false, time: "03:00", count: 3 },
      timeZone: TZ,
      nextRunAt: null,
      requests: [],
      starters: [],
    });

    await setNightly({ enabled: true, time: "23:59" });
    const first = queued()!;
    expect(first.type).toBe("nightly");
    expect(isoLocal(first.runAfter, TZ).slice(11, 16)).toBe("23:59");
    expect(first.runAfter).toBe(s.nightly.nextRunAt());
    // the same settings again keep the job
    await setNightly({ enabled: true, time: "23:59" });
    expect(queued()!.id).toBe(first.id);

    await setNightly({ enabled: true, time: "00:01" });
    const moved = queued()!;
    expect(moved.id).not.toBe(first.id);
    expect(s.repos.jobs.get(first.id)!.status).toBe("cancelled");
    expect(isoLocal(moved.runAfter, TZ).slice(11, 16)).toBe("00:01");
    expect(localDate(moved.runAfter, TZ) > today()).toBe(true);
    expect((await call<NightlyResponse>("GET", planningNightlyPaths.nightly)).body.nextRunAt).toBe(
      moved.runAfter,
    );

    await setNightly({ enabled: false, time: "00:01" });
    expect(queued()).toBeNull();
    expect(s.repos.jobs.get(moved.id)).toMatchObject({ status: "cancelled", lastError: NIGHTLY_OFF });
  });

  test("the job makes today's request for the open slots, runs it without a push, and queues tomorrow's", async () => {
    await setNightly({ enabled: true, count: 2 });
    const job = queued()!;
    // the test hook: due now instead of at 03:00
    s.repos.db.query("UPDATE jobs SET run_after = 0 WHERE id = ?").run(job.id);
    app.worker!.wake();
    const request = await waitFor("a nightly request", () => nightlies()[0]);
    expect(request).toMatchObject({ origin: "nightly", timeZone: TZ });
    expect(request.filters).toMatchObject({ days: [today()], count: 2, sourceMode: "adapted" });
    expect(request.filters.slots.every((x) => ["breakfast", "lunch", "dinner"].includes(x))).toBe(true);
    const round = await doneRound(request.id);
    expect(round).toMatchObject({ number: 1, kind: "first", status: "done" });
    // dinner first (the fake's nightly script), each a ready suggestion
    const ideas = s.repos.planningRounds.suggestions(round.id);
    expect(ideas.map((x) => x.status)).toEqual(["ready", "ready"]);
    expect(ideas[0]!.proposedSlot).toBe(request.filters.slots.at(-1)!);
    // the starters it saved, as the app reads them
    const view = (await call<NightlyResponse>("GET", planningNightlyPaths.nightly)).body;
    expect(view.requests.map((d) => d.request.id)).toEqual([request.id]);
    expect(view.starters.map((x) => x.kind)).toEqual(["protein_gap", "other", "season", "variety"]);
    expect(view.starters[0]).toMatchObject({
      text: "High protein tonight",
      filters: { when: "today", slots: ["dinner"], constraints: ["high_protein"] },
      ref: {},
      meal: null,
    });
    // the job is done and tomorrow's is queued (today had its run)
    await waitFor("the next job", () => queued()?.id !== job.id && queued());
    expect(s.repos.jobs.get(job.id)!.status).toBe("done");
    expect(localDate(queued()!.runAfter, TZ) > today()).toBe(true);
  });

  test("off when it runs: nothing is made", async () => {
    await setNightly({ enabled: true });
    const job = queued()!;
    s.repos.settings.set(PLANNING_SETTINGS_KEY, DEFAULT_PLANNING_SETTINGS);
    s.repos.db.query("UPDATE jobs SET run_after = 0 WHERE id = ?").run(job.id);
    app.worker!.wake();
    await waitFor("the job settled", () => s.repos.jobs.get(job.id)!.status === "cancelled");
    expect(nightlies()).toEqual([]);
    expect(queued()).toBeNull();
  });

  test("everything planned today: skipped, and Regenerate says so", async () => {
    const planned = planEverything();
    expect(s.nightly.run()).toBeNull();
    expect(nightlies()).toEqual([]);
    const r = await call<{ error: string; hint: string }>("POST", planningNightlyPaths.regenerate, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("nothing is open today");
    for (const id of planned) s.planning.unplan(id);
  });

  test("Regenerate: today's suggestions stay until the new ones are done; an empty one goes at once", async () => {
    const first = await call<RegenerateNightlyResponse>("POST", planningNightlyPaths.regenerate, {});
    expect(first.status).toBe(201);
    expect(first.body.request.origin).toBe("nightly");
    await doneRound(first.body.request.id);

    const id = crypto.randomUUID();
    const second = await call<RegenerateNightlyResponse>("POST", planningNightlyPaths.regenerate, { id });
    expect(second.status).toBe(201);
    expect(second.body.request.id).toBe(id);
    // a retry answers the same request
    const again = await call<RegenerateNightlyResponse>("POST", planningNightlyPaths.regenerate, { id });
    expect(again.status).toBe(200);
    expect(again.body.request.id).toBe(id);
    expect(nightlies().map((r) => r.id)).toContain(first.body.request.id);
    await doneRound(id);
    await waitFor("the earlier one archived", () => nightlies().length === 1);
    expect(nightlies().map((r) => r.id)).toEqual([id]);
    expect(s.repos.planningRequests.get(first.body.request.id)!.archivedAt).not.toBeNull();

    // one without a ready suggestion (still queued: no worker picks it before this) goes at once
    await app.worker!.stop();
    const third = s.nightly.regenerate({});
    const fourth = s.nightly.regenerate({});
    expect(s.repos.planningRequests.get(third.request.id)!.archivedAt).not.toBeNull();
    expect(s.repos.planningRounds.listForRequest(third.request.id)[0]!.status).toBe("failed");
    expect(nightlies().map((r) => r.id)).toEqual([fourth.request.id, id]);
  });
});

describe("a nightly request for a past day", () => {
  test("the next run archives it at once, whatever it holds", async () => {
    const app = start();
    servers.push(app);
    const s = app.services;
    const { request } = s.planningRequests.create({ filters: { count: 1 }, tz: TZ }, "nightly");
    // as if it was made yesterday
    const yesterday = localDate(Date.now() - 86_400_000, TZ);
    s.repos.db
      .query("UPDATE planning_requests SET filters = json_set(filters, '$.days', json_array(?)) WHERE id = ?")
      .run(yesterday, request.id);
    const res = s.nightly.run()!;
    expect(s.repos.planningRequests.get(request.id)!.archivedAt).not.toBeNull();
    expect(s.repos.planningRequests.listOpenOf("nightly").map((r) => r.id)).toEqual([res.request.id]);
    // the view only lists today's
    expect(s.nightly.view().requests.map((d) => d.request.id)).toEqual([res.request.id]);
  });
});
