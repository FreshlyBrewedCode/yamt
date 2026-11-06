import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  addDays,
  goalPaths,
  type MealResponse,
  mealPaths,
  type PickSuggestionResponse,
  type PlannedMealResponse,
  type PlanningInputResponse,
  type PlanningRequestDetail,
  type PlanningRequestResponse,
  type PlanningRequestsResponse,
  planningPaths,
  planningRequestPaths,
  requestTitle,
  type StartRoundResponse,
  type SuggestionResponse,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { newId } from "../src/db/index.ts";
import { dedupeKeys } from "../src/db/repos/jobs.ts";
import {
  DIDNT_COMPLETE,
  REQUEST_ARCHIVED,
  type SaveSuggestionInput,
} from "../src/domain/planning-requests.ts";
import { dayRange, localDate } from "../src/domain/time.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { fixture, tempDir } from "./helpers.ts";

// Planning requests, inputs, rounds, suggestions and picking (#44). Suggestions are written through
// the service, as #45's tools will; made-up foods and recipes. Each describe gets a server of its own.

const TZ = "Europe/Berlin";
const HOUR = 3_600_000;
const servers: AppServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop()));
});

function setup() {
  const app = createServer({
    dataDir: join(tempDir(), "data"),
    port: 0,
    webDist: null,
    auth: { kind: "tailnet", login: "alice@example.com" },
    timeZone: TZ,
    // a stand-in decoder: any JPEG will do as the derivative
    heicToJpeg: async () => fixture("gradient.jpg"),
  });
  servers.push(app);
  const s = app.services;
  const svc = s.planningRequests;
  const headers = { [IDENTITY_HEADER]: "alice@example.com", origin: new URL(app.localUrl).origin };
  async function call<T>(method: string, path: string, body?: unknown) {
    const form = body instanceof FormData;
    const res = await fetch(new URL(path, app.localUrl), {
      method,
      headers: form ? headers : { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as T & ApiError,
      headers: res.headers,
    };
  }
  const today = localDate(Date.now(), TZ);
  const food = (name: string, per100g: { energyKcal: number; protein?: number; fat?: number }) =>
    s.foods.create({ source: "custom", name, per100g }).id;
  const lentils = food("Rote Linsen, trocken", { energyKcal: 340, protein: 24, fat: 1.5 });
  const tomatoes = food("Tomaten, gehackt", { energyKcal: 20, protein: 1, fat: 0.2 });
  /** A complete suggestion for 2: per portion 160 g lentils + 400 g tomatoes → 624 kcal, 42.4 g protein. */
  const dal = (title = "Linsen-Dal", more: Partial<SaveSuggestionInput> = {}): SaveSuggestionInput => ({
    recipe: {
      title,
      summary: "Rote Linsen mit Tomaten",
      sourceMode: "composed",
      servings: 2,
      timeActiveMin: 15,
      timeTotalMin: 30,
      steps: ["Alles 20 Minuten köcheln."],
      items: [
        {
          foodId: lentils,
          description: "320 g rote Linsen",
          grams: 320,
          provenance: "database",
          confidence: "high",
        },
        {
          foodId: tomatoes,
          description: "800 g Tomaten",
          grams: 800,
          provenance: "database",
          confidence: "high",
        },
      ],
    },
    why: ["40 g Protein pro Portion", "In 30 Minuten fertig"],
    ...more,
  });
  const create = async (body: Record<string, unknown> = {}) => {
    const res = await call<PlanningRequestResponse>("POST", planningRequestPaths.requests, {
      tz: TZ,
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.request;
  };
  const detail = async (id: string) =>
    (await call<PlanningRequestDetail>("GET", planningRequestPaths.request(id))).body;
  const suggest = (id: string, body: object = {}) =>
    call<StartRoundResponse>("POST", planningRequestPaths.suggest(id), body);
  const more = (id: string, body: object = {}) =>
    call<StartRoundResponse>("POST", planningRequestPaths.more(id), body);
  const text = (id: string, t: string) =>
    call<PlanningInputResponse>("POST", planningRequestPaths.inputs(id), { kind: "text", text: t });
  /** A round filled as #45's job will: started, outlined with `count` ideas on `date`, `ready` of them saved. */
  const fill = (roundId: string, opts: { date?: string; ready?: number; finish?: boolean } = {}) => {
    const round = svc.startRound(roundId, null);
    const date = opts.date ?? today;
    svc.saveOutline(roundId, {
      ideas: Array.from({ length: round.count }, (_, n) => ({
        title: `Idee ${n + 1}`,
        approach: "Eine Linsen-Idee",
        sourceMode: "composed" as const,
        proposedDate: date,
        proposedSlot: "dinner" as const,
      })),
    });
    const saved = Array.from({ length: opts.ready ?? 1 }, (_, n) =>
      svc.saveSuggestion(roundId, n, dal(`Dal ${n + 1}`)),
    );
    if (opts.finish !== false) svc.finishRound(roundId);
    return saved;
  };
  const at = (date: string, hour: number) => dayRange(date, TZ).from + hour * HOUR;
  /** A run of the round, as the plan job (#45) records one before it takes the round. */
  const run = (roundId: string) =>
    s.repos.planningRuns.insert({
      id: newId(),
      roundId,
      jobId: null,
      attempt: 1,
      harness: "custom",
      model: null,
      effort: null,
      startedAt: Date.now(),
    }).id;
  return { app, s, svc, call, headers, today, create, detail, suggest, more, text, fill, dal, at, run };
}

describe("requests", () => {
  const { s, call, today, create, detail } = setup();

  test("made with the defaults filled in, a title from the filters, the text as the first input", async () => {
    const request = await create({ text: "Etwas mit Linsen" });
    expect(request).toMatchObject({
      title: requestTitle({ days: [today], slots: ["dinner"] }),
      origin: "user",
      timeZone: TZ,
      archivedAt: null,
      filters: {
        days: [today],
        slots: ["dinner"],
        timeCapMin: null,
        constraints: [],
        useUp: [],
        sourceMode: "adapted",
        portionsCooked: 1,
        count: 3,
      },
    });
    const thread = await detail(request.id);
    expect(thread.inputs).toMatchObject([{ kind: "text", text: "Etwas mit Linsen", roundId: null }]);
    expect(thread.rounds).toEqual([]);
    expect(thread.pendingInputs).toBe(1);
  });

  test("filters as given: days sorted and distinct, slots in order, constraints distinct", async () => {
    const days = [addDays(today, 2), addDays(today, 1), addDays(today, 2)];
    const request = await create({
      filters: {
        days,
        slots: ["dinner", "lunch"],
        constraints: ["vegetarian", "no_oven", "vegetarian", "ohne Pilze"],
        useUp: [{ text: "½ Hokkaido" }],
        sourceMode: "published",
        portionsCooked: 2,
        count: 2,
        timeCapMin: 30,
      },
    });
    expect(request.filters).toEqual({
      days: [addDays(today, 1), addDays(today, 2)],
      slots: ["lunch", "dinner"],
      constraints: ["vegetarian", "no_oven", "ohne Pilze"],
      useUp: [{ text: "½ Hokkaido" }],
      sourceMode: "published",
      portionsCooked: 2,
      count: 2,
      timeCapMin: 30,
    });
  });

  test("idempotent with a client id; days in the past, a bad zone or a bad filter are refused", async () => {
    const id = Bun.randomUUIDv7();
    const first = await call<PlanningRequestResponse>("POST", planningRequestPaths.requests, { id, tz: TZ });
    const again = await call<PlanningRequestResponse>("POST", planningRequestPaths.requests, { id, tz: TZ });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body.request).toEqual(first.body.request);

    const past = await call("POST", planningRequestPaths.requests, {
      filters: { days: [addDays(today, -1)] },
      tz: TZ,
    });
    expect(past.status).toBe(400);
    expect(past.body.error).toContain("lies in the past");
    const wide = await call("POST", planningRequestPaths.requests, {
      filters: { days: [today, addDays(today, 40)] },
      tz: TZ,
    });
    expect(wide.status).toBe(400);
    expect((await call("POST", planningRequestPaths.requests, { tz: "Mars/Olympus" })).status).toBe(400);
    expect((await call("POST", planningRequestPaths.requests, { filters: { count: 7 } })).status).toBe(400);
    expect((await call("POST", planningRequestPaths.requests, { filters: { bogus: 1 } })).status).toBe(400);
    expect((await call("GET", planningRequestPaths.request(Bun.randomUUIDv7()))).status).toBe(404);
  });

  test("archived: out of the list, no writes but an unarchive; both idempotent", async () => {
    const request = await create({ text: "Archiv" });
    const listed = async () =>
      (await call<PlanningRequestsResponse>("GET", planningRequestPaths.requests)).body.requests.map(
        (r) => r.request.id,
      );
    expect(await listed()).toContain(request.id);
    const archived = await call<PlanningRequestResponse>("POST", planningRequestPaths.archive(request.id));
    expect(archived.body.request.archivedAt).not.toBeNull();
    expect(
      (await call<PlanningRequestResponse>("POST", planningRequestPaths.archive(request.id))).body.request,
    ).toEqual(archived.body.request);
    expect(await listed()).not.toContain(request.id);
    for (const res of [
      await call("POST", planningRequestPaths.inputs(request.id), { kind: "text", text: "noch was" }),
      await call("POST", planningRequestPaths.suggest(request.id)),
      await call("POST", planningRequestPaths.retractInput((await detail(request.id)).inputs[0]!.id)),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: REQUEST_ARCHIVED, hint: "unarchive it first" });
    }
    // still readable
    expect((await detail(request.id)).request.archivedAt).not.toBeNull();
    await call("POST", planningRequestPaths.unarchive(request.id));
    await call("POST", planningRequestPaths.unarchive(request.id));
    expect(await listed()).toContain(request.id);
    expect(s.repos.planningRequests.get(request.id)?.archivedAt).toBeNull();
  });

  test("titles: weekdays, ranges, several slots, dates past a week", () => {
    // 2026-11-03 is a Tuesday
    expect(requestTitle({ days: ["2026-11-03"], slots: ["dinner"] })).toBe("Dinner Tue");
    expect(requestTitle({ days: ["2026-11-03", "2026-11-04", "2026-11-05"], slots: ["dinner"] })).toBe(
      "Dinners Tue–Thu",
    );
    expect(requestTitle({ days: ["2026-11-03", "2026-11-05"], slots: ["dinner"] })).toBe("Dinners Tue, Thu");
    expect(requestTitle({ days: ["2026-11-06"], slots: ["dinner", "lunch"] })).toBe("Lunch and dinner Fri");
    expect(requestTitle({ days: ["2026-11-03", "2026-11-04"], slots: ["breakfast", "lunch", "snack"] })).toBe(
      "Breakfasts, lunches and snacks Tue, Wed",
    );
    expect(requestTitle({ days: ["2026-11-28", "2026-12-07"], slots: ["lunch"] })).toBe(
      "Lunches 28 Nov–7 Dec",
    );
  });
});

describe("inputs", () => {
  const { app, s, call, create, detail, headers } = setup();

  test("text and links as JSON, idempotent with a client id; another request's id is a 409", async () => {
    const request = await create();
    const other = await create();
    const id = Bun.randomUUIDv7();
    const body = { id, kind: "link", url: "https://example.com/rezept", text: "So ungefähr" };
    const first = await call<PlanningInputResponse>("POST", planningRequestPaths.inputs(request.id), body);
    const again = await call<PlanningInputResponse>("POST", planningRequestPaths.inputs(request.id), body);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(first.body.input).toMatchObject({
      kind: "link",
      url: "https://example.com/rezept",
      text: "So ungefähr",
      roundId: null,
      retractedAt: null,
    });
    expect(first.body.transcript).toBeNull();
    expect((await call("POST", planningRequestPaths.inputs(other.id), body)).status).toBe(409);
    expect(
      (
        await call("POST", planningRequestPaths.inputs(request.id), {
          kind: "link",
          url: "ftp://example.com",
        })
      ).status,
    ).toBe(400);
    expect((await call("POST", planningRequestPaths.inputs(request.id), { kind: "audio" })).status).toBe(400);
    const future = Date.now() + 2 * HOUR;
    expect(
      (
        await call("POST", planningRequestPaths.inputs(request.id), {
          kind: "text",
          text: "x",
          capturedAt: future,
        })
      ).status,
    ).toBe(400);
  });

  test("photos: stored like captures (EXIF time, a JPEG for HEIC), served with the same headers", async () => {
    const request = await create();
    const upload = (bytes: Uint8Array<ArrayBuffer>, type: string, name: string) => {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type }), name);
      return call<PlanningInputResponse>("POST", planningRequestPaths.inputs(request.id), form);
    };
    const jpeg = await upload(fixture("gradient.jpg"), "image/jpeg", "IMG_0001.JPG");
    expect(jpeg.status).toBe(201);
    expect(jpeg.body.input).toMatchObject({
      kind: "image",
      mimeType: "image/jpeg",
      takenAt: Date.UTC(2026, 9, 30, 11, 34, 56),
      jpegDerivative: null,
      fileName: "IMG_0001.JPG",
    });
    const get = (path: string, h: Record<string, string> = {}) =>
      fetch(new URL(path, app.localUrl), { headers: { ...headers, ...h } });
    const original = await get(planningRequestPaths.media(jpeg.body.input.id));
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("image/jpeg");
    expect(original.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(fixture("gradient.jpg"));
    const etag = original.headers.get("etag")!;
    expect(
      (await get(planningRequestPaths.media(jpeg.body.input.id), { "if-none-match": etag })).status,
    ).toBe(304);
    expect((await get(planningRequestPaths.mediaJpeg(jpeg.body.input.id))).status).toBe(404);

    const heic = await upload(fixture("gradient.heic"), "image/heic", "IMG_0002.HEIC");
    expect(heic.body.input).toMatchObject({ kind: "image", mimeType: "image/heic", jpegDerivative: "ok" });
    const derivative = await get(planningRequestPaths.mediaJpeg(heic.body.input.id));
    expect(derivative.headers.get("content-type")).toBe("image/jpeg");
    const record = s.repos.planningInputs.get(heic.body.input.id)!;
    expect(record.mediaPath).toMatch(new RegExp(`^media/\\d{4}/\\d{2}/${record.id}\\.heic$`));
    expect(record.jpegPath).toBe(record.mediaPath!.replace(/\.heic$/, ".jpg"));
    // a file that isn't what the kind says is refused
    const form = new FormData();
    form.set("file", new Blob([fixture("gradient.jpg")], { type: "image/jpeg" }), "memo.m4a");
    form.set("kind", "audio");
    expect((await call("POST", planningRequestPaths.inputs(request.id), form)).status).toBe(400);
  });

  test("retraction is soft and idempotent; the database refuses changing or deleting an input", async () => {
    const request = await create({ text: "weg damit" });
    const [input] = (await detail(request.id)).inputs;
    const first = await call<{ input: { retractedAt: number } }>(
      "POST",
      planningRequestPaths.retractInput(input!.id),
    );
    const again = await call<{ input: { retractedAt: number } }>(
      "POST",
      planningRequestPaths.retractInput(input!.id),
    );
    expect(first.body.input.retractedAt).toBeGreaterThan(0);
    expect(again.body.input.retractedAt).toBe(first.body.input.retractedAt);
    expect((await detail(request.id)).pendingInputs).toBe(0);
    expect((await call("POST", planningRequestPaths.retractInput(Bun.randomUUIDv7()))).status).toBe(404);
    const db = s.repos.db;
    expect(() => db.query("UPDATE planning_inputs SET text = 'anders' WHERE id = ?").run(input!.id)).toThrow(
      "immutable",
    );
    expect(() => db.query("UPDATE planning_inputs SET retracted_at = 1 WHERE id = ?").run(input!.id)).toThrow(
      "already retracted",
    );
    expect(() => db.query("DELETE FROM planning_inputs WHERE id = ?").run(input!.id)).toThrow(
      "never deleted",
    );
  });
});

describe("rounds", () => {
  const { s, svc, call, create, detail, suggest, more, text, fill, dal } = setup();

  test("the first round takes the inputs so far and queues a plan job; one open round at a time", async () => {
    const request = await create({ text: "Linsen" });
    const res = await suggest(request.id);
    expect(res.status).toBe(201);
    expect(res.body.round).toMatchObject({
      number: 1,
      kind: "first",
      status: "queued",
      count: 3,
      runId: null,
    });
    const job = s.repos.jobs.get(res.body.jobId)!;
    expect(job).toMatchObject({ type: "plan", payload: { roundId: res.body.round.id }, status: "queued" });
    expect(job.dedupeKey).toBe(dedupeKeys.plan(request.id));
    const thread = await detail(request.id);
    expect(thread.inputs.map((i) => i.roundId)).toEqual([res.body.round.id]);
    expect(thread.pendingInputs).toBe(0);

    // queued, then running: no second one, neither by suggest nor by more, nor in the database
    for (const r of [await suggest(request.id), await more(request.id)]) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("round 1 is queued");
    }
    svc.startRound(res.body.round.id, null);
    expect((await more(request.id)).body.error).toBe("round 1 is running");
    expect(() => s.repos.planningRounds.insert({ requestId: request.id, kind: "more", count: 3 })).toThrow(
      "UNIQUE",
    );
  });

  test("a retried suggest with the round's client id answers that round", async () => {
    const request = await create();
    const id = Bun.randomUUIDv7();
    const first = await suggest(request.id, { id });
    const again = await suggest(request.id, { id });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body).toEqual(first.body);
    const other = await create();
    expect((await suggest(other.id, { id })).status).toBe(409);
  });

  test("after a round: suggest steers with what arrived since, more asks again; inputs during a round wait for the next", async () => {
    const request = await create({ text: "Linsen" });
    expect((await more(request.id)).body).toMatchObject({
      error: "there is no round yet",
      hint: "suggest first",
    });
    const r1 = (await suggest(request.id)).body.round;
    fill(r1.id, { finish: false });
    // arrives while round 1 runs: it belongs to round 2
    const late = (await text(request.id, "Lieber mit Spinat")).body.input;
    svc.finishRound(r1.id);
    expect(s.repos.planningInputs.get(late.id)?.roundId).toBeNull();

    const r2 = (await suggest(request.id)).body.round;
    expect(r2).toMatchObject({ number: 2, kind: "steer" });
    expect(s.repos.planningInputs.get(late.id)?.roundId).toBe(r2.id);
    fill(r2.id);
    // nothing new: suggest refuses, more asks again with the same input
    expect((await suggest(request.id)).body).toMatchObject({
      error: "nothing new since the last round",
      hint: "add an input, or ask for more",
    });
    const r3 = (await more(request.id)).body.round;
    expect(r3).toMatchObject({ number: 3, kind: "more" });
    svc.startRound(r3.id, null);
    svc.failRound(r3.id, "the harness wasn't reachable");
    // more with something new steers with it; a retracted input counts for nothing
    await text(request.id, "Ohne Koriander");
    const retracted = (await text(request.id, "doch nicht")).body.input;
    await call("POST", planningRequestPaths.retractInput(retracted.id));
    const r4 = (await more(request.id)).body.round;
    expect(r4).toMatchObject({ number: 4, kind: "steer" });
    expect(s.repos.planningInputs.listForRound(r4.id).map((i) => i.text)).toEqual(["Ohne Koriander"]);
    expect(s.repos.planningInputs.get(retracted.id)?.roundId).toBeNull();

    const thread = await detail(request.id);
    expect(thread.rounds.map((r) => [r.number, r.kind, r.status])).toEqual([
      [1, "first", "done"],
      [2, "steer", "done"],
      [3, "more", "failed"],
      [4, "steer", "queued"],
    ]);
    expect(thread.rounds[2]!.error).toBe("the harness wasn't reachable");
    expect(() =>
      s.repos.db.query("UPDATE planning_inputs SET round_id = ? WHERE id = ?").run(r1.id, late.id),
    ).toThrow("in a round already");
  });

  test("the list: open requests newest first, the latest round counted, inputs pending", async () => {
    const older = await create({ text: "älter" });
    const newer = await create({ text: "neuer" });
    const round = (await suggest(older.id)).body.round;
    fill(round.id, { ready: 2 });
    await text(older.id, "noch etwas");
    const { requests } = (await call<PlanningRequestsResponse>("GET", planningRequestPaths.requests)).body;
    const ids = requests.map((r) => r.request.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(requests.find((r) => r.request.id === newer.id)).toMatchObject({
      latestRound: null,
      inputs: 1,
      pendingInputs: 1,
    });
    expect(requests.find((r) => r.request.id === older.id)).toMatchObject({
      latestRound: { id: round.id, number: 1, status: "done", count: 3, outlined: 0, ready: 2, failed: 1 },
      inputs: 2,
      pendingInputs: 1,
    });
  });

  test("archiving fails the open round, cancels its job and its ideas not yet ready", async () => {
    const request = await create();
    const round = (await suggest(request.id)).body;
    await call("POST", planningRequestPaths.archive(request.id));
    expect(s.repos.planningRounds.get(round.round.id)).toMatchObject({
      status: "failed",
      error: REQUEST_ARCHIVED,
    });
    expect(s.repos.jobs.get(round.jobId)).toMatchObject({ status: "cancelled", lastError: REQUEST_ARCHIVED });

    const running = await create();
    const r = (await suggest(running.id)).body.round;
    fill(r.id, { finish: false });
    await call("POST", planningRequestPaths.archive(running.id));
    const thread = await detail(running.id);
    expect(thread.rounds[0]).toMatchObject({ status: "failed", error: REQUEST_ARCHIVED });
    expect(thread.rounds[0]!.suggestions.map((x) => x.status)).toEqual(["ready", "failed", "failed"]);
    expect(() => svc.saveSuggestion(r.id, 1, dal())).toThrow("not running");
  });
});

describe("the agent's side", () => {
  const { svc, create, detail, suggest, dal, today, run } = setup();
  const round = async (filters: Record<string, unknown> = {}) => {
    const request = await create({ filters });
    return (await suggest(request.id)).body.round;
  };
  const ideas = (n: number, date = today) =>
    Array.from({ length: n }, (_, i) => ({
      title: `Idee ${i + 1}`,
      approach: "Etwas mit Linsen",
      sourceMode: "adapted" as const,
      sourceUrl: "https://example.com/linsen",
      proposedDate: date,
      proposedSlot: "dinner" as const,
    }));

  test("only a running round takes an outline: exactly its count, which may replace the request's title", async () => {
    const r = await round({ count: 2 });
    expect(() => svc.saveOutline(r.id, { ideas: ideas(2) })).toThrow("not running");
    // the round names one of its own runs only
    expect(() => svc.startRound(r.id, Bun.randomUUIDv7())).toThrow("not a run of this round");
    svc.startRound(r.id, run(r.id));
    expect(() => svc.startRound(r.id, null)).toThrow("not queued");
    expect(() => svc.saveOutline(r.id, { ideas: ideas(3) })).toThrow("asks for 2, not 3");
    const outline = svc.saveOutline(r.id, { ideas: ideas(2), requestTitle: "Linsen am Abend" });
    expect(outline.map((s) => [s.position, s.status, s.title, s.sourceMode, s.proposedSlot])).toEqual([
      [0, "outlined", "Idee 1", "adapted", "dinner"],
      [1, "outlined", "Idee 2", "adapted", "dinner"],
    ]);
    expect((await detail(r.requestId)).request.title).toBe("Linsen am Abend");
    // a retried attempt replaces the outline while nothing is ready
    const again = svc.saveOutline(r.id, { ideas: ideas(2).reverse() });
    expect(again.map((s) => s.title)).toEqual(["Idee 2", "Idee 1"]);
    svc.saveSuggestion(r.id, 0, dal());
    expect(() => svc.saveOutline(r.id, { ideas: ideas(2) })).toThrow("has ready suggestions");
  });

  test("a saved suggestion is a recipe; a second save replaces it; a failed idea keeps its reason", async () => {
    const r = await round();
    svc.startRound(r.id, null);
    expect(() => svc.saveSuggestion(r.id, 0, dal())).toThrow("no idea 0");
    svc.saveOutline(r.id, { ideas: ideas(3) });
    const first = svc.saveSuggestion(r.id, 0, dal("Linsen-Dal", { proposedSlot: "lunch" }));
    expect(first).toMatchObject({
      status: "ready",
      title: "Linsen-Dal",
      sourceMode: "composed",
      sourceUrl: null,
      proposedDate: today,
      proposedSlot: "lunch",
      why: ["40 g Protein pro Portion", "In 30 Minuten fertig"],
      recipe: { title: "Linsen-Dal", servings: 2 },
      // per portion: 160 g lentils (544 kcal, 38.4 g) + 400 g tomatoes (80 kcal, 4 g)
      perPortion: { grams: 560, items: 2, nutrients: { energyKcal: 624, protein: 42.4 } },
    });
    const replaced = svc.saveSuggestion(r.id, 0, dal("Linsen-Dal mit Spinat"));
    expect(replaced.recipeId).not.toBe(first.recipeId);
    expect(replaced.title).toBe("Linsen-Dal mit Spinat");
    expect(() => svc.saveSuggestion(r.id, 1, dal("x", { why: ["1", "2", "3", "4", "5"] }))).toThrow(
      "at most 4",
    );
    // validated like any recipe
    expect(() => svc.saveSuggestion(r.id, 1, { recipe: { ...dal().recipe, items: [] } })).toThrow(
      "at least one item",
    );

    expect(svc.failSuggestion(r.id, 1, "Kein Rezept gefunden, das ohne Ofen geht")).toMatchObject({
      status: "failed",
      failure: "Kein Rezept gefunden, das ohne Ofen geht",
    });
    expect(() => svc.failSuggestion(r.id, 0, "zu spät")).toThrow("is ready");
    // the run ends: what's still outlined didn't complete
    expect(svc.finishRound(r.id)).toMatchObject({ status: "done", error: null });
    const [done] = (await detail(r.requestId)).rounds;
    expect(done!.endedAt).not.toBeNull();
    expect(done!.suggestions.map((s) => [s.status, s.failure])).toEqual([
      ["ready", null],
      ["failed", "Kein Rezept gefunden, das ohne Ofen geht"],
      ["failed", DIDNT_COMPLETE],
    ]);
    expect(() => svc.saveSuggestion(r.id, 2, dal())).toThrow("not running");
  });

  test("without a ready suggestion a round doesn't finish: it is requeued or failed", async () => {
    const r = await round();
    svc.startRound(r.id, run(r.id));
    svc.saveOutline(r.id, { ideas: ideas(3) });
    expect(svc.finishRound(r.id)).toBeNull();
    expect(svc.requeueRound(r.id, "attempt 1 failed")).toMatchObject({
      status: "queued",
      error: "attempt 1 failed",
    });
    const second = run(r.id);
    expect(svc.startRound(r.id, second)).toMatchObject({ status: "running", runId: second, error: null });
    expect(svc.failRound(r.id, "no suggestion completed")).toMatchObject({
      status: "failed",
      error: "no suggestion completed",
    });
    expect(() => svc.failRound(r.id, "again")).toThrow("failed already");
    expect((await detail(r.requestId)).rounds[0]!.suggestions.every((s) => s.status === "failed")).toBe(true);
  });
});

describe("picking", () => {
  const { s, svc, call, today, create, detail, suggest, fill } = setup();
  const ready = async (filters: Record<string, unknown> = {}, date = today) => {
    const request = await create({ filters });
    const round = (await suggest(request.id)).body.round;
    const [suggestion] = fill(round.id, { date });
    return { request, suggestion: suggestion! };
  };
  const pick = (id: string, body: object = {}) =>
    call<PickSuggestionResponse>("POST", planningRequestPaths.pick(id), body);

  test("pick: a planned meal from the recipe on the proposed day and slot, portions from the request", async () => {
    const { request, suggestion } = await ready({ portionsCooked: 2 }, addDays(today, 1));
    const res = await pick(suggestion.id);
    expect(res.status).toBe(201);
    expect(res.body.plannedMeal).toMatchObject({
      date: addDays(today, 1),
      slot: "dinner",
      recipeId: suggestion.recipeId,
      title: "Dal 1",
      portionsCooked: 2,
      portionEaten: 1,
      status: "planned",
      suggestionId: suggestion.id,
    });
    expect(res.body.suggestion).toMatchObject({ verdict: "picked", plannedMealId: res.body.plannedMeal.id });
    // picked: refused again (change the planned meal), and can't be rejected
    expect((await pick(suggestion.id)).body).toMatchObject({
      error: "the suggestion was picked already",
      hint: "change its planned meal instead",
    });
    expect((await call("POST", planningRequestPaths.reject(suggestion.id))).status).toBe(409);
    const tally = (
      await call<PlanningRequestsResponse>("GET", planningRequestPaths.requests)
    ).body.requests.find((r) => r.request.id === request.id);
    expect(tally?.latestRound?.picked).toBe(1);

    // unplanning the planned meal undoes the pick; it can be picked again, elsewhere
    expect((await call("DELETE", planningPaths.plannedMeal(res.body.plannedMeal.id))).status).toBe(204);
    expect(svc.suggestion(suggestion.id)).toMatchObject({ verdict: null, plannedMealId: null });
    const elsewhere = await pick(suggestion.id, {
      date: addDays(today, 2),
      slot: "lunch",
      portionEaten: 0.5,
    });
    expect(elsewhere.body.plannedMeal).toMatchObject({
      date: addDays(today, 2),
      slot: "lunch",
      portionEaten: 0.5,
    });
  });

  test("idempotent with the planned meal's client id; only ready ones; another planned meal's id is a 409", async () => {
    const { suggestion } = await ready();
    const id = Bun.randomUUIDv7();
    const first = await pick(suggestion.id, { id });
    const again = await pick(suggestion.id, { id });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body.plannedMeal.id).toBe(id);
    const other = await ready();
    expect((await pick(other.suggestion.id, { id })).body.error).toBe("id: another planned meal has this id");

    const thread = await detail(other.request.id);
    const failed = thread.rounds[0]!.suggestions.find((x) => x.status === "failed")!;
    expect((await pick(failed.id)).body).toMatchObject({ error: "the suggestion is failed, not ready" });
    expect((await call("POST", planningRequestPaths.reject(failed.id))).status).toBe(409);
    expect((await pick(Bun.randomUUIDv7())).status).toBe(404);
  });

  test("without a proposed day (or a past one) and slot, the pick goes to the request's next open slot", async () => {
    const tomorrow = addDays(today, 1);
    const { suggestion } = await ready({ days: [today, tomorrow], slots: ["lunch", "dinner"] });
    // proposed for yesterday (the agent's mistake, or a stale thread)
    s.repos.db
      .query("UPDATE planning_suggestions SET proposed_date = ?, proposed_slot = NULL WHERE id = ?")
      .run(addDays(today, -1), suggestion.id);
    // today's lunch and dinner are planned already: the next open one is tomorrow's lunch
    const recipeId = suggestion.recipeId!;
    await call("POST", planningPaths.plannedMeals, { recipeId, date: today, slot: "lunch" });
    await call("POST", planningPaths.plannedMeals, { recipeId, date: today, slot: "dinner" });
    const res = await pick(suggestion.id);
    expect([res.body.plannedMeal.date, res.body.plannedMeal.slot]).toEqual([tomorrow, "lunch"]);
    // with a proposed slot, the slot stays and the day moves on
    const other = await ready({ days: [today, tomorrow], slots: ["lunch", "dinner"] }, addDays(today, -1));
    const again = await pick(other.suggestion.id);
    expect([again.body.plannedMeal.date, again.body.plannedMeal.slot]).toEqual([tomorrow, "dinner"]);
  });

  test("reject and unreject are idempotent; a rejected one is unrejected before it is picked", async () => {
    const { suggestion } = await ready();
    const reject = () => call<SuggestionResponse>("POST", planningRequestPaths.reject(suggestion.id));
    const unreject = () => call<SuggestionResponse>("POST", planningRequestPaths.unreject(suggestion.id));
    expect((await reject()).body.suggestion.verdict).toBe("rejected");
    expect((await reject()).body.suggestion.verdict).toBe("rejected");
    expect((await pick(suggestion.id)).body).toMatchObject({
      error: "the suggestion was rejected",
      hint: "unreject it first",
    });
    expect((await unreject()).body.suggestion.verdict).toBeNull();
    expect((await unreject()).body.suggestion.verdict).toBeNull();
    expect((await pick(suggestion.id)).status).toBe(201);
    expect((await unreject()).status).toBe(409);
  });
});

describe("the fit", () => {
  const { s, call, today, create, detail, suggest, fill, at } = setup();

  test("its day's projection with it, kcal left and protein open; a pick isn't counted twice", async () => {
    await call("POST", goalPaths.goals, { energyKcal: 2000, protein: 150, effectiveFrom: today });
    const tomorrow = addDays(today, 1);
    // tomorrow: breakfast planned (another recipe's portion) → in the projection
    const request = await create({ filters: { days: [tomorrow] } });
    const round = (await suggest(request.id)).body.round;
    const [suggestion] = fill(round.id, { date: tomorrow });
    const breakfast = (
      await call<PlannedMealResponse>("POST", planningPaths.plannedMeals, {
        recipeId: suggestion!.recipeId,
        date: tomorrow,
        slot: "breakfast",
        portionEaten: 0.5,
      })
    ).body.plannedMeal;
    const view = (await detail(request.id)).rounds[0]!.suggestions[0]!;
    const per = view.perPortion!.nutrients;
    expect(per).toMatchObject({ energyKcal: 624, protein: 42.4 });
    expect(view.fit).toMatchObject({
      date: tomorrow,
      slot: "dinner",
      before: { nutrients: { energyKcal: breakfast.eaten.nutrients.energyKcal } },
      with: { nutrients: { energyKcal: 936, protein: 63.6 } },
      goal: { targets: { energyKcal: 2000, protein: 150 } },
      kcalLeft: 2000 - 936,
      proteinOpen: 86.4,
    });
    expect(view.fit!.progress?.energyKcal).toEqual({ eaten: 936, target: 2000, left: 1064, over: false });

    // picked: the planned meal is in the projection now, and the fit counts it once
    const picked = (await call<PickSuggestionResponse>("POST", planningRequestPaths.pick(suggestion!.id)))
      .body;
    expect(picked.suggestion.fit).toMatchObject({
      date: tomorrow,
      slot: "dinner",
      before: { nutrients: { energyKcal: 312 } },
      with: { nutrients: { energyKcal: 936 } },
      kcalLeft: 1064,
    });
    // skipped: out of the projection, so the fit adds it again
    await call("POST", planningPaths.skip(picked.plannedMeal.id));
    expect(s.planningRequests.suggestion(suggestion!.id).fit).toMatchObject({
      before: { nutrients: { energyKcal: 312 } },
      with: { nutrients: { energyKcal: 936 } },
    });
  });

  test("an eaten meal counts in its day's projection", async () => {
    const request = await create();
    const round = (await suggest(request.id)).body.round;
    const meal = (
      await call<MealResponse>("POST", mealPaths.meals, { eatenAt: Math.min(at(today, 9), Date.now()) })
    ).body.meal;
    s.revisions.save({
      mealId: meal.id,
      runId: null,
      title: "Porridge",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: "Porridge",
          grams: 100,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 400, protein: 10 },
        },
      ],
      questions: [],
    });
    const [suggestion] = fill(round.id);
    expect(suggestion!.fit).toMatchObject({
      date: today,
      before: { nutrients: { energyKcal: 400 } },
      with: { nutrients: { energyKcal: 1024 } },
    });
  });
});
