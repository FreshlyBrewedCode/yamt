import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ApiError,
  DEFAULT_PLANNING_SETTINGS,
  type PlanningRequestResponse,
  type PlanningSettingsBody,
  type PlanningSettingsResponse,
  planningRequestPaths,
  planningSettingsPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { tempDir } from "./helpers.ts";

// Settings → Planning (#46): the suggestions-per-round, source mode and portions defaults, and the
// preferences. One JSON value (the settings table's `planning` key), like `agent`.

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
  });
  servers.push(app);
  const headers = { [IDENTITY_HEADER]: "alice@example.com", origin: new URL(app.localUrl).origin };
  async function call<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(new URL(path, app.localUrl), {
      method,
      headers: { ...headers, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T & ApiError };
  }
  return { app, call };
}

describe("GET/PUT /api/planning/settings", () => {
  const { call } = setup();

  test("the defaults until something is saved", async () => {
    const r = await call<PlanningSettingsResponse>("GET", planningSettingsPaths.settings);
    expect(r.body.settings).toEqual(DEFAULT_PLANNING_SETTINGS);
  });

  test("validated: count 2-5, portions 1-4, a strict body", async () => {
    const bad = (body: unknown) => call<ApiError>("PUT", planningSettingsPaths.settings, body);
    expect((await bad({ ...DEFAULT_PLANNING_SETTINGS, count: 1 })).status).toBe(400);
    expect((await bad({ ...DEFAULT_PLANNING_SETTINGS, count: 6 })).status).toBe(400);
    expect((await bad({ ...DEFAULT_PLANNING_SETTINGS, portionsCooked: 5 })).status).toBe(400);
    expect((await bad({ ...DEFAULT_PLANNING_SETTINGS, extra: true })).status).toBe(400);
    expect(
      (
        await bad({
          ...DEFAULT_PLANNING_SETTINGS,
          preferences: { ...DEFAULT_PLANNING_SETTINGS.preferences, weekdayCookingMin: 2 },
        })
      ).status,
    ).toBe(400);
  });

  test("a whole replace, read back", async () => {
    const settings: PlanningSettingsBody = {
      count: 5,
      sourceMode: "published",
      portionsCooked: 2,
      preferences: {
        dislikes: ["Rosenkohl"],
        neverEat: ["Erdnüsse"],
        equipment: ["kein Ofen"],
        weekdayCookingMin: 30,
        favouriteSites: ["chefkoch.de"],
      },
    };
    const put = await call<PlanningSettingsResponse>("PUT", planningSettingsPaths.settings, settings);
    expect(put.status).toBe(200);
    expect(put.body.settings).toEqual(settings);
    const get = await call<PlanningSettingsResponse>("GET", planningSettingsPaths.settings);
    expect(get.body.settings).toEqual(settings);
  });
});

describe("a new request falls back to the saved settings (#46), not just PLANNING_DEFAULTS", () => {
  const { call } = setup();

  test("count, source mode and portions come from Settings → Planning once saved", async () => {
    await call("PUT", planningSettingsPaths.settings, {
      ...DEFAULT_PLANNING_SETTINGS,
      count: 4,
      sourceMode: "published",
      portionsCooked: 3,
    });
    const res = await call<PlanningRequestResponse>("POST", planningRequestPaths.requests, {
      text: "Etwas mit Linsen",
    });
    expect(res.status).toBe(201);
    expect(res.body.request.filters).toMatchObject({
      sourceMode: "published",
      portionsCooked: 3,
      count: 4,
      // untouched by the setting: still PLANNING_DEFAULTS'
      slots: ["dinner"],
      timeCapMin: null,
    });
  });

  test("a request's own filters still win over the saved settings", async () => {
    const res = await call<PlanningRequestResponse>("POST", planningRequestPaths.requests, {
      filters: { count: 2 },
    });
    expect(res.status).toBe(201);
    expect(res.body.request.filters).toMatchObject({ count: 2, sourceMode: "published", portionsCooked: 3 });
  });
});
