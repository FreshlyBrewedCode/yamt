import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type ApiError,
  addDays,
  type CaptureResponse,
  type MealDetailResponse,
  type MealResponse,
  mealPaths,
  type RetractResponse,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { dataPaths } from "../src/config.ts";
import { localDate } from "../src/domain/time.ts";
import { McpTokens } from "../src/mcp/tokens.ts";
import { mapFdcFood } from "../src/nutrition/nutrients.ts";
import { computeTotals } from "../src/nutrition/totals.ts";
import { createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";
import { fixtureFetch, readFixture } from "./nutrition-fixtures.ts";

const TZ = "Europe/Berlin";
const fetchFake = fixtureFetch();
const app = createServer({
  dataDir: join(tempDir(), "data"),
  port: 0,
  webDist: null,
  auth: { kind: "tailnet", login: "alice@example.com" },
  fetch: fetchFake,
  fdcApiKey: "test-key",
  timeZone: TZ,
});
const s = app.services;
const interactive = s.mcpTokens.interactiveToken();
const clients: Client[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await app.stop();
});
beforeEach(() => {
  fetchFake.fail.clear();
});

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "yamt-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(app.mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

/** Calls a tool and returns its parsed JSON (or the error text with isError). */
async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content[0]?.text ?? "";
  if (res.isError) return { error: text, data: null as T | null };
  return { error: null, data: JSON.parse(text) as T };
}
const ok = async <T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) => {
  const r = await call<T>(client, name, args);
  if (r.error !== null) throw new Error(`${name}: ${r.error}`);
  return r.data as T;
};
const fails = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = await call(client, name, args);
  if (r.error === null) throw new Error(`${name} should have failed`);
  return r.error;
};

async function api<T>(method: string, path: string, body?: unknown) {
  const res = await fetch(new URL(path, app.localUrl), {
    method,
    headers: { [IDENTITY_HEADER]: "alice@example.com", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
const newMeal = async () => (await api<MealResponse>("POST", mealPaths.meals, {})).body.meal;
const addText = async (mealId: string, text: string) =>
  (await api<CaptureResponse>("POST", mealPaths.captures(mealId), { kind: "text", text })).body.capture;

interface Candidate {
  foodId: string;
  foundIn: string;
  source: string;
  name: string;
  brand: string | null;
  per100g: Record<string, number | null>;
}
interface RevisionOut {
  id: string;
  number: number;
  status: string;
  items: { food: { foodId: string } | null; nutrients: Record<string, number | null> }[];
  questions: { id: string; answer: string | null }[];
  totals: Record<string, number>;
  totalsByProvenance: Record<string, { items: number; energyKcal: number }>;
  missing: Record<string, number>;
}

describe("token store", () => {
  test("the interactive token lives in the data dir (0600), stable until rotated", () => {
    const file = join(tempDir(), "mcp-token");
    const tokens = new McpTokens(file);
    const t = tokens.interactiveToken();
    expect(t).toMatch(/^yamt_[\w-]{43}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new McpTokens(file).interactiveToken()).toBe(t);
    expect(tokens.verify(t)).toEqual({ kind: "interactive" });

    // another process (the CLI) rotates it: the old one stops working at once
    const rotated = new McpTokens(file).rotateInteractive();
    expect(rotated).not.toBe(t);
    expect(tokens.verify(t)).toBeNull();
    expect(tokens.verify(rotated)).toEqual({ kind: "interactive" });
  });

  test("run tokens are scoped to a meal, revocable and expire", () => {
    let now = 1_000;
    const tokens = new McpTokens(join(tempDir(), "mcp-token"), () => now);
    const a = tokens.mintRun({ runId: "run-1", mealId: "meal-1", ttlMs: 500 });
    const b = tokens.mintRun({ runId: "run-2", mealId: "meal-2" });
    expect(tokens.verify(a)).toEqual({ kind: "run", runId: "run-1", mealId: "meal-1" });
    tokens.revokeRun("run-2");
    expect(tokens.verify(b)).toBeNull();
    now += 501;
    expect(tokens.verify(a)).toBeNull();
    expect(tokens.verify("yamt_guess")).toBeNull();
  });
});

describe("/mcp", () => {
  const post = (headers: Record<string, string>) =>
    fetch(app.mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  test("needs a known bearer token; the tailnet identity is not enough", async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: "Bearer yamt_nope" })).status).toBe(401);
    expect((await post({ [IDENTITY_HEADER]: "alice@example.com" })).status).toBe(403);
    expect((await post({ Authorization: `Bearer ${interactive}` })).status).toBe(200);
  });

  test("refuses browsers and requests through tailscale serve, even with a token", async () => {
    const auth = { Authorization: `Bearer ${interactive}` };
    expect((await post({ ...auth, origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ ...auth, "x-forwarded-for": "100.64.0.2" })).status).toBe(403);
  });

  test("stateless: one JSON answer per POST, no session, 405 for GET", async () => {
    const res = await post({ Authorization: `Bearer ${interactive}` });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(9);
    const get = await fetch(app.mcpUrl, { headers: { Authorization: `Bearer ${interactive}` } });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  test("the SDK client connects, gets the instructions and the tools with their schemas", async () => {
    const client = await connect(interactive);
    expect(client.getInstructions()).toContain("yamt is the user's meal and macro log");
    expect(client.getInstructions()?.split("\n")).toHaveLength(2);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "get_meal",
      "search_foods",
      "get_food",
      "lookup_barcode",
      "create_food",
      "fetch_recipe",
      "save_meal_revision",
      "get_day_summary",
      "get_goals",
    ]);
    const save = tools.find((t) => t.name === "save_meal_revision")!;
    expect(save.inputSchema.required).toEqual(["mealId", "title", "items"]);
  });

  test("invalid arguments come back as a tool error", async () => {
    const client = await connect(interactive);
    expect(await fails(client, "get_meal", { mealId: "nope" })).toContain("invalid arguments");
    expect(await fails(client, "no_such_tool", {})).toContain("no tool");
  });
});

describe("tools end to end (fixtures)", () => {
  test("search → create/link foods → save revision → computed totals; history first afterwards", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    await addText(meal.id, "60 g Haferflocken mit 150 g Skyr, dazu ein Schuss Olivenöl und ein Riegel");

    const oats = await ok<{ candidates: Candidate[]; unavailable: unknown[] }>(client, "search_foods", {
      query: "haferflocken",
      sources: ["off"],
      limit: 5,
    });
    expect(oats.unavailable).toEqual([]);
    expect(oats.candidates[0]).toMatchObject({ foundIn: "off", source: "off", name: "Haferflocken" });
    const oatFood = oats.candidates[0]!;

    const skyr = await ok<{ found: boolean; food: Candidate }>(client, "lookup_barcode", {
      barcode: "4337185761638",
    });
    expect(skyr).toMatchObject({
      found: true,
      food: { name: "Skyr natur", brand: "K-Classic", source: "off" },
    });

    // FDC search hits are cached too, with a food id
    const fdc = await ok<{ candidates: Candidate[] }>(client, "search_foods", {
      query: "oats",
      sources: ["fdc"],
    });
    const rawOats = fdc.candidates.find((c) => c.name === "Oats, raw")!;
    expect(rawOats).toMatchObject({ foundIn: "fdc", source: "fdc" });

    const bar = await ok<Candidate>(client, "create_food", {
      source: "label",
      name: "Nussriegel",
      brand: "Example",
      barcode: "4000000000024",
      per100g: { energyKcal: 500, protein: 10, fat: 30, carbohydrate: 45, sugars: 25, fiber: 5, salt: 0.2 },
      portions: [{ label: "1 Riegel", grams: 40 }],
    });
    expect(bar).toMatchObject({ source: "label", sourceRef: "4000000000024", name: "Nussriegel" });

    const saved = await ok<{ mealStatus: string; revision: RevisionOut }>(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Porridge mit Skyr",
      summary: "Haferflocken mit Skyr, Öl und ein Riegel.",
      assumptions: ["1 EL Olivenöl angenommen"],
      items: [
        {
          foodId: oatFood.foodId,
          description: "60 g Haferflocken",
          grams: 60,
          provenance: "weighed",
          confidence: "high",
        },
        {
          foodId: skyr.food.foodId,
          description: "150 g Skyr",
          grams: 150,
          provenance: "weighed",
          confidence: "high",
        },
        {
          description: "ein Schuss Olivenöl",
          grams: 13.5,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 884, fat: 100 },
        },
        {
          foodId: bar.foodId,
          description: "ein Riegel",
          grams: 40,
          provenance: "label",
          confidence: "medium",
        },
      ],
    });
    expect(saved.mealStatus).toBe("analysed");
    const rev = saved.revision;
    expect(rev).toMatchObject({ number: 1, status: "analysed" });
    // the same numbers the pure function gives for these items
    const expected = computeTotals([
      { grams: 60, per100g: { ...nulls, ...oatFood.per100g }, provenance: "weighed" },
      { grams: 150, per100g: { ...nulls, ...skyr.food.per100g }, provenance: "weighed" },
      { grams: 13.5, per100g: { ...nulls, energyKcal: 884, fat: 100 }, provenance: "estimate" },
      { grams: 40, per100g: { ...nulls, ...bar.per100g }, provenance: "label" },
    ]);
    expect(rev.totals).toEqual({ grams: 263.5, ...expected.nutrients });
    // 223.2 + 96 + 119.34 + 200, rounded once
    expect(rev.totals.energyKcal).toBe(639);
    expect(rev.totalsByProvenance).toEqual({
      weighed: { items: 2, energyKcal: 319 },
      label: { items: 1, energyKcal: 200 },
      estimate: { items: 1, energyKcal: 119 },
    });
    expect(rev.missing).toEqual({
      protein: 1,
      saturatedFat: 2,
      carbohydrate: 1,
      sugars: 1,
      fiber: 1,
      salt: 1,
    });

    // the same revision through the HTTP API, totals computed the same way
    const detail = await api<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body.meal).toMatchObject({ status: "analysed", currentRevisionId: rev.id });
    expect(detail.body.revision?.totals.nutrients).toEqual(expected.nutrients);

    // next time, the foods the user ate come first
    const again = await ok<{ candidates: Candidate[] }>(client, "search_foods", {
      query: "haferflocken",
      limit: 5,
    });
    expect(again.candidates[0]).toMatchObject({ foundIn: "history", foodId: oatFood.foodId, usedInMeals: 1 });
    expect(again.candidates.filter((c) => c.foodId === oatFood.foodId)).toHaveLength(1);
  });

  test("get_meal: captures with transcripts and media paths, the current revision, what arrived since", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    const before = await addText(meal.id, "Ein Apfel");
    const link = (
      await api<CaptureResponse>("POST", mealPaths.captures(meal.id), {
        kind: "link",
        url: "https://example.com/r",
      })
    ).body.capture;
    const retracted = await addText(meal.id, "Tippfehler");
    await api<RetractResponse>("POST", mealPaths.retract(retracted.id));
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode("ftypM4A ")])]),
      "memo.m4a",
    );
    await fetch(new URL(mealPaths.captures(meal.id), app.localUrl), {
      method: "POST",
      headers: { [IDENTITY_HEADER]: "alice@example.com" },
      body: form,
    });
    const audio = s.repos.captures.listForMeal(meal.id).find((c) => c.kind === "audio")!;
    s.repos.transcripts.complete(audio.id, {
      text: "Ich hatte einen Apfel",
      model: "test",
      language: "de",
      durationMs: 1000,
      segments: null,
    });
    await ok(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Apfel",
      items: [
        {
          description: "Apfel",
          grams: 150,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 52 },
        },
      ],
    });
    await Bun.sleep(2);
    const after = await addText(meal.id, "Korrektur: zwei Äpfel");

    const got = await ok<{
      meal: { eatenAt: string };
      captures: Record<string, unknown>[];
      retractedCaptures: number;
      currentRevision: RevisionOut;
      revisions: unknown[];
    }>(client, "get_meal", { mealId: meal.id });
    expect(got.meal.eatenAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(got.retractedCaptures).toBe(1);
    expect(got.captures.map((c) => c.id)).toEqual([before.id, link.id, audio.id, after.id]);
    expect(got.captures[1]).toMatchObject({ kind: "link", url: "https://example.com/r" });
    expect(got.captures[2]).toMatchObject({
      kind: "audio",
      transcript: { status: "done", text: "Ich hatte einen Apfel" },
    });
    expect(got.captures[0]?.afterCurrentRevision).toBe(false);
    expect(got.captures[3]?.afterCurrentRevision).toBe(true);
    expect(got.currentRevision.totals.energyKcal).toBe(78);
    expect(got.revisions).toHaveLength(1);
  });

  test("photos come with a local path; unknown meals are a tool error", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    const form = new FormData();
    form.set("file", Bun.file(join(import.meta.dir, "fixtures", "gradient.jpg")), "plate.jpg");
    await fetch(new URL(mealPaths.captures(meal.id), app.localUrl), {
      method: "POST",
      headers: { [IDENTITY_HEADER]: "alice@example.com" },
      body: form,
    });
    const got = await ok<{ captures: { media: { path: string; mimeType: string } }[] }>(client, "get_meal", {
      mealId: meal.id,
    });
    expect(got.captures[0]?.media.mimeType).toBe("image/jpeg");
    expect(got.captures[0]?.media.path.startsWith(join(s.dataDir, "media"))).toBe(true);
    expect(await Bun.file(got.captures[0]!.media.path).exists()).toBe(true);
    expect(await fails(client, "get_meal", { mealId: "0190f5e2-0000-7000-8000-000000000000" })).toContain(
      "meal not found",
    );
  });

  test("save_meal_revision validates items, links and questions", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    const item = { description: "x", grams: 10, provenance: "estimate", confidence: "low" };
    const save = (extra: Record<string, unknown>) =>
      fails(client, "save_meal_revision", { mealId: meal.id, title: "T", items: [item], ...extra });
    expect(await save({})).toContain("give a foodId, or estimatePer100g");
    expect(await save({ items: [{ ...item, foodId: "0190f5e2-0000-7000-8000-000000000000" }] })).toContain(
      "no food",
    );
    expect(
      await save({ items: [{ ...item, provenance: "database", estimatePer100g: { energyKcal: 100 } }] }),
    ).toContain("needs a foodId");
    const q = { question: "?", whyItMatters: "!", impactKcal: 150 };
    expect(
      await save({ items: [{ ...item, estimatePer100g: { energyKcal: 1 } }], questions: [q, q, q] }),
    ).toContain("invalid arguments");
    expect(await fails(client, "save_meal_revision", { mealId: meal.id, title: "T", items: [] })).toContain(
      "needs items",
    );
    expect(s.repos.revisions.listForMeal(meal.id)).toEqual([]);
  });

  test("questions → needs_input; answers link to the current revision's questions only", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    await addText(meal.id, "Nudeln mit Soße");
    const saved = await ok<{ mealStatus: string; revision: RevisionOut }>(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Nudeln",
      eatenAt: "2026-11-02T12:30:00+01:00",
      items: [
        {
          description: "Nudeln",
          grams: 250,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 150 },
        },
      ],
      questions: [{ question: "Mit Sahnesoße?", whyItMatters: "Sahne ändert viel", impactKcal: 300 }],
    });
    expect(saved.mealStatus).toBe("needs_input");
    const question = saved.revision.questions[0]!;
    expect(s.repos.meals.get(meal.id)).toMatchObject({
      eatenAt: Date.parse("2026-11-02T11:30:00Z"),
      eatenAtSource: "agent",
    });

    // an answer to it
    const answer = await api<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      kind: "answer",
      text: "Ja, mit Sahne",
      questionId: question.id,
    });
    expect(answer.status).toBe(201);
    expect(answer.body.capture.questionId).toBe(question.id);
    expect(s.repos.revisions.question(question.id)?.answeredByCaptureId).toBe(answer.body.capture.id);
    const view = await ok<{ currentRevision: RevisionOut }>(client, "get_meal", { mealId: meal.id });
    expect(view.currentRevision.questions[0]?.answer).toBe("Ja, mit Sahne");

    // retracting it unlinks it
    await api("POST", mealPaths.retract(answer.body.capture.id));
    expect(s.repos.revisions.question(question.id)?.answeredByCaptureId).toBeNull();

    // another meal's question, or a superseded one, is refused
    const other = await newMeal();
    const bad = await api<ApiError>("POST", mealPaths.captures(other.id), {
      kind: "answer",
      text: "Ja",
      questionId: question.id,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("questionId");
    await ok(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Nudeln mit Sahnesoße",
      items: [
        {
          description: "Nudeln",
          grams: 400,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 180 },
        },
      ],
    });
    const stale = await api<ApiError>("POST", mealPaths.captures(meal.id), {
      kind: "answer",
      text: "Ja",
      questionId: question.id,
    });
    expect(stale.status).toBe(400);
    expect(s.repos.meals.get(meal.id)?.status).toBe("analysed");
    // the database refuses a question of another meal too (no FK on captures.question_id)
    expect(() =>
      s.repos.captures.insert({
        id: Bun.randomUUIDv7(),
        mealId: other.id,
        kind: "answer",
        text: "x",
        questionId: question.id,
      }),
    ).toThrow("question_id must name a question of the same meal");
  });

  test("a meal with another analysis queued stays queued", async () => {
    const client = await connect(interactive);
    const meal = await newMeal();
    await addText(meal.id, "Brot");
    await api("POST", mealPaths.analyse(meal.id));
    const saved = await ok<{ mealStatus: string }>(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Brot",
      items: [
        {
          description: "Brot",
          grams: 50,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 250 },
        },
      ],
    });
    expect(saved.mealStatus).toBe("queued");
    expect(s.repos.meals.get(meal.id)?.currentRevisionId).not.toBeNull();
  });

  test("revisions are immutable in the database", async () => {
    const meal = await newMeal();
    const view = s.revisions.save({
      mealId: meal.id,
      runId: null,
      title: "T",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: "x",
          grams: 1,
          provenance: "estimate",
          confidence: "low",
          estimatePer100g: { energyKcal: 1 },
        },
      ],
      questions: [],
    });
    expect(() => s.repos.db.run("UPDATE meal_revisions SET title = 'changed'")).toThrow("immutable");
    expect(() => s.repos.db.run("UPDATE meal_items SET grams = 2")).toThrow("immutable");
    expect(() => s.repos.db.run(`DELETE FROM meal_revisions WHERE id = '${view.revision.id}'`)).toThrow();
  });

  test("lookup_barcode: unknown, a label food wins, cached when OFF is down", async () => {
    const client = await connect(interactive);
    expect(await ok(client, "lookup_barcode", { barcode: "0000000000000" })).toMatchObject({ found: false });
    expect(await fails(client, "lookup_barcode", { barcode: "abc123" })).toContain("barcode");

    const first = await ok<{ food: Candidate }>(client, "lookup_barcode", { barcode: "4260070610493" });
    expect(first.food).toMatchObject({ name: "Zarte Haferflocken", per100g: { energyKcal: 373 } });
    fetchFake.fail.set(/openfoodfacts/, 503);
    expect(await ok(client, "lookup_barcode", { barcode: "4260070610493", refresh: true })).toMatchObject({
      found: true,
      food: { foodId: first.food.foodId },
    });

    await ok(client, "create_food", {
      source: "label",
      name: "Zarte Haferflocken (Etikett)",
      barcode: "4260070610493",
      per100g: { energyKcal: 370 },
    });
    expect(await ok(client, "lookup_barcode", { barcode: "4260070610493" })).toMatchObject({
      food: { source: "label", per100g: { energyKcal: 370 } },
    });
  });

  test("search reports a source that is down instead of failing", async () => {
    const client = await connect(interactive);
    fetchFake.fail.set(/openfoodfacts\.org/, 503);
    const res = await ok<{ candidates: Candidate[]; unavailable: { source: string; reason: string }[] }>(
      client,
      "search_foods",
      { query: "skyr natur kaputt", sources: ["off", "history"] },
    );
    expect(res.unavailable).toEqual([{ source: "off", reason: "HTTP 503" }]);
  });

  test("get_food completes an FDC search hit with its details (portions)", async () => {
    const client = await connect(interactive);
    const hit = mapFdcFood({
      fdcId: 171413,
      description: "Oil, olive, salad or cooking",
      foodNutrients: [{ nutrientId: 1008, value: 884, unitName: "KCAL" }],
    });
    const cached = s.repos.foods.save({
      source: "fdc",
      sourceRef: "171413",
      data: hit,
      raw: {},
      fetchedAt: Date.now(),
    });
    expect(cached.portions).toEqual([]);
    const food = await ok<Candidate & { portions: unknown[]; nutrients: Record<string, unknown> }>(
      client,
      "get_food",
      {
        foodId: cached.id,
      },
    );
    expect(food.portions).toContainEqual({ label: "1 tablespoon", grams: 13.5 });
    expect(Object.keys(food.nutrients).length).toBeGreaterThan(20);
  });

  test("fetch_recipe parses a recipe page; refuses private addresses", async () => {
    const client = await connect(interactive);
    const url = "https://www.chefkoch.de/rezepte/1491131254215808/Spaghetti-Carbonara.html";
    fetchFake.pages.set(url, { body: readFixture("chefkoch-carbonara.html") });
    expect(await ok(client, "fetch_recipe", { url })).toMatchObject({
      kind: "recipe",
      recipe: { servings: 4, nutrition: { calories: "564 kcal" } },
    });
    expect(await fails(client, "fetch_recipe", { url: "http://127.0.0.1:7890/api/meals" })).toContain(
      "not a public address",
    );
  });

  test("get_day_summary: today's meals with their totals and the day's", async () => {
    const client = await connect(interactive);
    const day = await ok<{
      date: string;
      meals: { mealId: string; title: string | null; totals: Record<string, number> | null }[];
      totals: Record<string, number>;
      unanalysedMeals: number;
    }>(client, "get_day_summary", {});
    expect(day.date).toBe(localDate(Date.now(), TZ));
    const analysed = day.meals.filter((m) => m.totals !== null);
    expect(analysed.length).toBeGreaterThan(0);
    const sum = analysed.reduce((a, m) => a + (m.totals?.energyKcal ?? 0), 0);
    expect(Math.abs(day.totals.energyKcal! - sum)).toBeLessThanOrEqual(analysed.length);
    expect(day.unanalysedMeals).toBe(day.meals.length - analysed.length);
    expect(await fails(client, "get_day_summary", { timeZone: "Mars/Olympus" })).toContain(
      "unknown time zone",
    );
    const empty = await ok<{ meals: unknown[]; goal: unknown; progress: unknown; weight: unknown[] }>(
      client,
      "get_day_summary",
      { date: "2001-01-01" },
    );
    expect(empty).toMatchObject({ meals: [], goal: null, progress: null, weight: [] });
  });

  test("get_goals and get_day_summary: the goal in force, the progress against it, the day's weight", async () => {
    const client = await connect(interactive);
    const today = localDate(Date.now(), TZ);
    expect(await ok(client, "get_goals", {})).toEqual({ date: today, inForce: null, goals: [] });

    const post = (body: unknown) => api<{ goal: { id: string } }>("POST", "/api/goals", body);
    const old = (await post({ energyKcal: 2600, protein: 140, effectiveFrom: "2026-01-01" })).body.goal;
    const now = (await post({ energyKcal: 2400, protein: 160, fiber: 35, note: "Cut", effectiveFrom: today }))
      .body.goal;
    await api("POST", "/api/weight", { kg: 81.2 });

    const goals = await ok<{
      inForce: { goalId: string };
      goals: {
        goalId: string;
        effectiveFrom: string;
        until: string | null;
        targets: Record<string, unknown>;
      }[];
    }>(client, "get_goals", {});
    expect(goals.inForce.goalId).toBe(now.id);
    expect(goals.goals.map((g) => [g.goalId, g.until])).toEqual([
      [now.id, null],
      [old.id, addDays(today, -1)],
    ]);
    expect(goals.goals[0]).toMatchObject({
      note: "Cut",
      targets: { energyKcal: 2400, protein: 160, fat: null, carbohydrate: null, fiber: 35 },
    });
    const then = await ok<{ inForce: { goalId: string } }>(client, "get_goals", { date: "2026-02-01" });
    expect(then.inForce.goalId).toBe(old.id);
    expect(await fails(client, "get_goals", { timeZone: "Mars/Olympus" })).toContain("unknown time zone");

    const day = await ok<{
      totals: Record<string, number>;
      goal: { goalId: string; targets: Record<string, number | null> };
      progress: Record<string, { eaten: number; target: number | null; left: number | null; over: boolean }>;
      weight: { kg: number; measuredAt: string }[];
    }>(client, "get_day_summary", {});
    expect(day.goal.goalId).toBe(now.id);
    expect(day.progress.energyKcal).toMatchObject({
      eaten: day.totals.energyKcal,
      target: 2400,
      left: 2400 - day.totals.energyKcal!,
    });
    expect(day.progress.fat).toMatchObject({ target: null, left: null, over: false });
    expect(day.weight.map((w) => w.kg)).toEqual([81.2]);
    expect(day.weight[0]!.measuredAt).toMatch(/[+-]\d\d:\d\d$/);
  });
});

describe("run tokens", () => {
  test("see their meal only, record the run on the revision, stop working when revoked", async () => {
    const meal = await newMeal();
    const other = await newMeal();
    await addText(meal.id, "Banane");
    const token = s.mcpTokens.mintRun({ runId: "run-abc", mealId: meal.id });
    const client = await connect(token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("get_day_summary");
    expect(tools.map((t) => t.name)).not.toContain("get_goals");
    expect(await fails(client, "get_day_summary", {})).toContain("no tool");
    expect(await fails(client, "get_meal", { mealId: other.id })).toContain(`only use meal ${meal.id}`);
    await ok(client, "get_meal", { mealId: meal.id });
    await ok(client, "search_foods", { query: "skyr", sources: ["off"] });
    const saved = await ok<{ revision: { id: string } }>(client, "save_meal_revision", {
      mealId: meal.id,
      title: "Banane",
      items: [
        {
          description: "Banane",
          grams: 120,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 89 },
        },
      ],
    });
    expect(s.repos.revisions.get(saved.revision.id)?.runId).toBe("run-abc");

    s.mcpTokens.revokeRun("run-abc");
    const res = await fetch(app.mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("without an FDC key", () => {
  test("search says FDC is unavailable and never calls it", async () => {
    const f = fixtureFetch();
    const noKey = createServer({
      dataDir: join(tempDir(), "data"),
      port: 0,
      webDist: null,
      auth: { kind: "off" },
      fetch: f,
    });
    try {
      const res = await noKey.services.foods.search("oats", { sources: ["fdc", "history"] });
      expect(res.unavailable).toEqual([{ source: "fdc", reason: "no FDC_API_KEY configured" }]);
      expect(f.calls).toEqual([]);
      expect(Bun.file(dataPaths(noKey.services.dataDir).mcpToken).size).toBeGreaterThan(0);
    } finally {
      await noKey.stop();
    }
  });
});

const nulls = {
  energyKcal: null,
  protein: null,
  fat: null,
  saturatedFat: null,
  carbohydrate: null,
  sugars: null,
  fiber: null,
  salt: null,
};
