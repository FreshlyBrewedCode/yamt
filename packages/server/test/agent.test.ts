import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentOptionsResponse,
  type AgentResponse,
  type ApiError,
  agentPaths,
  type TraceEntry,
} from "@yamt/shared";
import {
  OPENCODE_INSTRUCTIONS,
  OPENCODE_PERMISSIONS,
  opencodeAdapter,
} from "../src/acp/adapters/opencode.ts";
import { configStep, effortOption, modelOption } from "../src/acp/config-options.ts";
import type * as acp from "../src/acp/protocol.ts";
import { AgentDiscovery, DiscoveryError } from "../src/agent/discovery.ts";
import { PLANNING_AGENT_SETTINGS_KEY, resolveAgent, resolvePlanningAgent } from "../src/agent/settings.ts";
import {
  type AnalysisConfig,
  analysisConfig,
  dataPaths,
  loadConfig,
  type PlanningAgentConfig,
  planningConfig,
} from "../src/config.ts";
import { type AppServer, createServer } from "../src/server.ts";
import { FAKE_AGENT, fakeAgentConfig, fakePlanningConfig, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

const cfg = (file: Parameters<typeof analysisConfig>[0], env: Record<string, string> = {}): AnalysisConfig =>
  analysisConfig(file, env);

describe("precedence: env > app > config.json > defaults", () => {
  test("defaults: Claude Code with claude-opus-5-5 and its own effort", () => {
    expect(resolveAgent(cfg({}), null)).toEqual({
      harness: { value: "claude-code", source: "default" },
      model: { value: "claude-opus-5-5", source: "default" },
      effort: { value: null, source: "default" },
    });
  });

  test("config.json under the app; a model belongs to its harness", () => {
    const file = cfg({ harness: "opencode", model: "opencode-go/glm-5.3", effort: "high" });
    expect(resolveAgent(file, null)).toEqual({
      harness: { value: "opencode", source: "config" },
      model: { value: "opencode-go/glm-5.3", source: "config" },
      effort: { value: "high", source: "config" },
    });
    // the app picks Claude Code: config.json's OpenCode model doesn't carry over
    expect(resolveAgent(file, { harness: "claude-code", model: null, effort: "low" })).toEqual({
      harness: { value: "claude-code", source: "app" },
      model: { value: "claude-opus-5-5", source: "default" },
      effort: { value: "low", source: "app" },
    });
    // the app picks OpenCode without a model: config.json's model for it applies
    expect(resolveAgent(file, { harness: "opencode", model: null, effort: "max" }).model).toEqual({
      value: "opencode-go/glm-5.3",
      source: "config",
    });
    // no model anywhere for a harness but Claude Code: its own default (null)
    expect(resolveAgent(cfg({}), { harness: "opencode", model: null, effort: null }).model).toEqual({
      value: null,
      source: "default",
    });
  });

  test("the env fixes what it sets, over the app", () => {
    const c = cfg(
      { harness: "opencode" },
      { YAMT_ANALYSIS_HARNESS: "claude-code", YAMT_ANALYSIS_EFFORT: "max" },
    );
    expect(resolveAgent(c, { harness: "opencode", model: "x", effort: "low" })).toEqual({
      harness: { value: "claude-code", source: "env", envVar: "YAMT_ANALYSIS_HARNESS" },
      model: { value: "claude-opus-5-5", source: "default" },
      effort: { value: "max", source: "env", envVar: "YAMT_ANALYSIS_EFFORT" },
    });
  });
});

describe("the planning agent (#45): env > the app's planning setting > config.json planning > defaults", () => {
  test("defaults: Claude Code with claude-opus-5-5 at effort medium (spike #38)", () => {
    expect(resolvePlanningAgent(planningConfig({}, {}), null)).toEqual({
      harness: { value: "claude-code", source: "default" },
      model: { value: "claude-opus-5-5", source: "default" },
      effort: { value: "medium", source: "default" },
    });
    // another harness has no built-in model or effort: its own
    expect(resolvePlanningAgent(planningConfig({ harness: "opencode" }, {}), null)).toMatchObject({
      model: { value: null, source: "default" },
      effort: { value: null, source: "default" },
    });
  });

  test("config.json `planning`, under the app's setting, under the env", () => {
    const file = planningConfig({ model: "claude-sonnet-5", effort: "high" }, {});
    expect(resolvePlanningAgent(file, null)).toEqual({
      harness: { value: "claude-code", source: "default" },
      model: { value: "claude-sonnet-5", source: "config" },
      effort: { value: "high", source: "config" },
    });
    expect(resolvePlanningAgent(file, { harness: "claude-code", model: null, effort: "low" }).effort).toEqual(
      {
        value: "low",
        source: "app",
      },
    );
    const env = planningConfig(
      { model: "claude-sonnet-5" },
      { YAMT_PLANNING_MODEL: "claude-opus-5-5", YAMT_PLANNING_EFFORT: "max" },
    );
    expect(resolvePlanningAgent(env, { harness: "claude-code", model: "x", effort: "low" })).toEqual({
      harness: { value: "claude-code", source: "app" },
      model: { value: "claude-opus-5-5", source: "env", envVar: "YAMT_PLANNING_MODEL" },
      effort: { value: "max", source: "env", envVar: "YAMT_PLANNING_EFFORT" },
    });
    expect(() => planningConfig({}, { YAMT_PLANNING_HARNESS: "nope" })).toThrow("YAMT_PLANNING_HARNESS");
  });

  test("the services read the app's planning setting per run, apart from the analysis's", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ planning: { effort: "high" } }));
    const config = loadConfig(dir, {});
    const app = createServer({
      dataDir: join(dir, "data"),
      port: 0,
      webDist: null,
      auth: { kind: "off" },
      analysis: { config: config.analysis },
      planning: { config: config.planning },
    });
    try {
      const agent = app.services.agent;
      expect(agent.forPlanning()).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
      app.services.repos.settings.set(PLANNING_AGENT_SETTINGS_KEY, {
        harness: "claude-code",
        model: "claude-sonnet-5",
        effort: null,
      });
      expect(agent.forPlanning()).toMatchObject({ model: "claude-sonnet-5", effort: "high" });
      expect(agent.forRun()).toMatchObject({ model: "claude-opus-5-5", effort: null });
    } finally {
      void app.stop();
    }
  });
});

const select = (
  id: string,
  category: string | null,
  values: string[],
  current = values[0]!,
): acp.SessionConfigOption => ({
  id,
  name: id,
  category,
  type: "select",
  currentValue: current,
  options: values.map((v) => ({ value: v, name: v.toUpperCase() })),
});

describe("config options, generically", () => {
  test("the model by category, else id; the effort by category thought_level, else a known id", () => {
    const claude = [
      select("mode", "mode", ["default", "plan"]),
      select("model", "model", ["opus", "sonnet"]),
      select("effort", "thought_level", ["default", "low", "max"]),
    ];
    expect(modelOption(claude)?.id).toBe("model");
    expect(effortOption(claude)?.id).toBe("effort");
    // another agent: no categories, a `thinking` select
    const other = [select("model", null, ["a", "b"]), select("thinking", null, ["off", "on"])];
    expect(modelOption(other)?.id).toBe("model");
    expect(effortOption(other)?.id).toBe("thinking");
    expect(effortOption([select("llm", "model", ["a"])])).toBeNull();
  });

  test("configStep: set when offered, nothing when current, skip when not offered", () => {
    const opts = [select("model", "model", ["a", "b"]), select("effort", "thought_level", ["low", "high"])];
    expect(configStep(opts, "model", "b")).toEqual({ kind: "set", configId: "model", value: "b" });
    expect(configStep(opts, "model", "a")).toBeNull();
    expect(configStep(opts, "model", "gone")).toMatchObject({ kind: "skip", reason: "not offered" });
    expect(configStep(opts.slice(0, 1), "effort", "high")).toMatchObject({
      kind: "skip",
      reason: "no option",
    });
  });
});

describe("discovery against the fake agent", () => {
  const harness = { kind: "custom" as const, command: process.execPath, args: [FAKE_AGENT], env: {} };

  test("models with labels; efforts after selecting the model; cached; refresh asks again", async () => {
    let now = 1_000;
    let spawns = 0;
    const dir = join(tempDir(), "discovery");
    const d = new AgentDiscovery({
      dir,
      now: () => now,
      discover: async (o) => {
        spawns++;
        const { discoverOptions } = await import("../src/acp/discover.ts");
        return discoverOptions(o);
      },
    });
    const first = await d.options(harness, null);
    expect(first.agent).toEqual({ name: "fake-agent", version: "1.0.0" });
    expect(first.models).toMatchObject({ id: "model", current: "fake-fast" });
    expect(first.models?.choices.map((c) => [c.value, c.name])).toEqual([
      ["fake-fast", "Fake Fast"],
      ["fake-smart", "Fake Smart"],
      ["fake-tiny", "Fake Tiny"],
    ]);
    expect(first.effort?.choices.map((c) => c.value)).toEqual(["low", "high"]);

    const smart = await d.options(harness, "fake-smart");
    expect(smart.effort).toMatchObject({ id: "effort", current: "medium" });
    expect(smart.effort?.choices.map((c) => c.value)).toEqual(["low", "medium", "high", "max"]);
    // the fake recorded the model being selected before the options were read
    const rec = JSON.parse(readFileSync(join(dir, "fake-agent.json"), "utf8")) as { configCalls: unknown };
    expect(rec.configCalls).toEqual([{ configId: "model", value: "fake-smart" }]);
    expect((await d.options(harness, "fake-tiny")).effort).toBeNull();
    expect(spawns).toBe(3);

    // cached for an hour
    await d.options(harness, null);
    expect(spawns).toBe(3);
    now += 61 * 60_000;
    await d.options(harness, null);
    expect(spawns).toBe(4);
    await d.options(harness, "fake-smart", { refresh: true });
    expect(spawns).toBe(5);
    await d.options(harness, null); // refresh dropped every model of the harness
    expect(spawns).toBe(6);
  });

  test("a missing command is not_installed, and not cached", async () => {
    const d = new AgentDiscovery({ dir: join(tempDir(), "discovery") });
    const missing = { ...harness, command: "yamt-no-such-agent", args: [] };
    const err = await d.options(missing, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect((err as DiscoveryError).failure).toBe("not_installed");
    expect(await d.options(missing, null).catch((e: unknown) => (e as DiscoveryError).failure)).toBe(
      "not_installed",
    );
  });
});

describe("the OpenCode adapter", () => {
  test("opencode acp; the skill as an instructions file and job permissions via OPENCODE_CONFIG_CONTENT", async () => {
    expect(opencodeAdapter.defaultLaunch()).toEqual({ command: "opencode", args: ["acp"] });
    expect(opencodeAdapter.modelViaMeta).toBe(false);
    const ctx = {
      cwd: "/tmp",
      systemPrompt: "# Log a meal",
      model: "opencode-go/glm-5.3",
      capabilities: {},
      mcp: { servers: [], allowedTools: [] },
      builtInTools: null,
      isolated: true,
    };
    // no ACP system prompt and no preamble: the instructions file carries it; no model in session/new
    expect(opencodeAdapter.sessionFields(ctx)).toEqual({});
    expect(opencodeAdapter.needsPromptPreamble(ctx)).toBe(false);
    const dir = tempDir();
    const env = await opencodeAdapter.prepareProcess!({ cwd: dir, systemPrompt: "# Log a meal\n" });
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!) as {
      instructions: string[];
      permission: unknown;
    };
    expect(config.instructions).toEqual([join(dir, OPENCODE_INSTRUCTIONS)]);
    expect(readFileSync(join(dir, OPENCODE_INSTRUCTIONS), "utf8")).toBe("# Log a meal\n");
    expect(config.permission).toEqual(OPENCODE_PERMISSIONS);
    // the catch-all first (the last matching rule wins), shell and edits denied, the yamt tools allowed
    expect(Object.keys(OPENCODE_PERMISSIONS)[0]).toBe("*");
    expect(OPENCODE_PERMISSIONS).toMatchObject({ bash: "deny", edit: "deny", "yamt_*": "allow" });
  });
});

// ---- the API and the runs ---------------------------------------------------------------------

function start(
  analysis: AnalysisConfig,
  which?: (c: string) => string | null,
  planning?: PlanningAgentConfig,
): AppServer {
  return createServer({
    dataDir: join(tempDir(), "data"),
    port: 0,
    webDist: null,
    auth: { kind: "off" },
    worker: { pollMs: 20 },
    analysis: {
      config: analysis,
      agent: { which },
      timeouts: { idleMs: 3000, toolIdleMs: 3000, turnMs: 10_000, cancelGraceMs: 300 },
    },
    ...(planning ? { planning: { config: planning } } : {}),
  });
}

const servers: AppServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

async function call<T>(app: AppServer, method: string, path: string, body?: unknown) {
  const res = await fetch(new URL(path, app.localUrl), {
    method,
    headers: { origin: new URL(app.localUrl).origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function analyse(app: AppServer, text = "Brot, fake:save") {
  const s = app.services;
  const m = s.meals.create({});
  s.meals.addJson(m.id, { kind: "text", text });
  s.meals.analyse(m.id);
  const deadline = Date.now() + 15_000;
  for (;;) {
    const run = s.repos.runs.listForMeal(m.id).find((r) => r.status !== "running");
    if (run) return run;
    if (Date.now() > deadline) throw new Error("no finished run");
    await Bun.sleep(20);
  }
}

const record = (app: AppServer, runId: string) =>
  JSON.parse(readFileSync(join(dataPaths(app.services.dataDir).runs, runId, "fake-agent.json"), "utf8")) as {
    configCalls: { configId: string; value: string }[];
    model: string;
    effort: string | null;
    systemPrompt: string;
    opencodeConfig: string | null;
  };

describe("GET/PUT /api/agent and the runs", () => {
  // the fake agent as config.json's custom harness, without a model of its own; OpenCode not on PATH
  const app = start(fakeAgentConfig({}, {}), (c) => (c === "opencode" ? null : Bun.which(c)));
  servers.push(app);

  test("the effective settings with sources; harnesses found here", async () => {
    const r = await call<AgentResponse>(app, "GET", agentPaths.agent);
    expect(r.body.harness).toEqual({ value: "custom", source: "config" });
    expect(r.body.model).toEqual({ value: null, source: "default" });
    expect(r.body.harnesses.map((h) => [h.kind, h.available])).toEqual([
      ["claude-code", true],
      ["opencode", false],
      ["custom", true],
    ]);
    expect(r.body.harnesses[1]?.reason).toBe("opencode isn't installed on the server");
  });

  test("options: discovered from the harness; unknown harness 400, missing one 503", async () => {
    const r = await call<AgentOptionsResponse>(
      app,
      "GET",
      `${agentPaths.options}?harness=custom&model=fake-smart`,
    );
    expect(r.status).toBe(200);
    expect(r.body.model).toBe("fake-smart");
    expect(r.body.effort?.choices.map((c) => c.name)).toEqual(["Low", "Medium", "High", "Max"]);
    expect((await call(app, "GET", `${agentPaths.options}?harness=codex`)).status).toBe(400);
    const missing = await call<ApiError>(app, "GET", `${agentPaths.options}?harness=opencode`);
    expect(missing).toEqual({
      status: 503,
      body: { error: "opencode isn't installed on the server", hint: "not_installed" },
    });
  });

  test("PUT is checked against what the harness offers", async () => {
    const bad = (body: unknown) => call<ApiError>(app, "PUT", agentPaths.agent, body);
    expect((await bad({ harness: "custom", model: "gpt-9", effort: null })).body.error).toBe(
      "Custom agent doesn't offer the model gpt-9",
    );
    // max exists for fake-smart, not for fake-fast (the default model)
    expect((await bad({ harness: "custom", model: null, effort: "max" })).body.error).toBe(
      "Custom agent doesn't offer the effort max",
    );
    expect((await bad({ harness: "custom", model: "fake-tiny", effort: "low" })).body.error).toBe(
      "Custom agent has no effort setting for fake-tiny",
    );
    expect((await bad({ harness: "opencode", model: null, effort: null })).status).toBe(400);
    expect((await bad({ harness: "custom", model: "fake-smart" })).status).toBe(400); // strict body

    const ok = await call<AgentResponse>(app, "PUT", agentPaths.agent, {
      harness: "custom",
      model: "fake-smart",
      effort: "max",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.model).toEqual({ value: "fake-smart", source: "app" });
    expect(ok.body.effort).toEqual({ value: "max", source: "app" });
  });

  test("a run sets the model first, then the effort, and records both", async () => {
    app.services.repos.settings.set("agent", { harness: "custom", model: "fake-smart", effort: "max" });
    const run = await analyse(app);
    expect(run).toMatchObject({
      status: "succeeded",
      harness: "custom",
      requestedModel: "fake-smart",
      model: "fake-smart-answered",
      requestedEffort: "max",
      effort: "max",
      configNote: null,
    });
    const rec = record(app, run.id);
    // effort after model: the model switch resets it to the model's default
    expect(rec.configCalls).toEqual([
      { configId: "model", value: "fake-smart" },
      { configId: "effort", value: "max" },
    ]);
    expect(rec.effort).toBe("max");
    const start = readFileSync(join(dataPaths(app.services.dataDir).runs, run.id, "trace.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as TraceEntry)
      .filter((e) => e.kind === "run.start" || e.kind === "config");
    expect(start.map((e) => [e.kind, e.what ?? null, e.effort ?? null])).toEqual([
      ["run.start", null, "max"],
      ["config", "model", null],
      ["config", "effort", null],
    ]);
  });

  test("a saved model or effort the harness doesn't offer any more: its default, and the run says so", async () => {
    // saved while fake-tiny still had efforts, say: now it has none
    app.services.repos.settings.set("agent", { harness: "custom", model: "fake-tiny", effort: "high" });
    const tiny = await analyse(app);
    expect(tiny).toMatchObject({ status: "succeeded", requestedEffort: "high", effort: null });
    expect(tiny.configNote).toBe(
      "Effort high isn't offered for fake-tiny, so the harness's default effort ran.",
    );
    expect(record(app, tiny.id).configCalls).toEqual([{ configId: "model", value: "fake-tiny" }]);

    app.services.repos.settings.set("agent", { harness: "custom", model: "fake-retired", effort: null });
    const gone = await analyse(app);
    expect(gone).toMatchObject({ status: "succeeded", requestedModel: "fake-retired", effort: "low" });
    expect(gone.model).toBe("fake-fast-answered");
    expect(gone.configNote).toBe(
      "Model fake-retired isn't offered by the harness, so its default model ran.",
    );
    expect(record(app, gone.id).configCalls).toEqual([]);
  });
});

describe("GET/PUT /api/agent/planning (#46): the planning line, saved and checked separately", () => {
  // the fake agent as both the analysis's and (via fakePlanningConfig) the planning's custom harness
  const app = start(fakeAgentConfig({}, {}), undefined, fakePlanningConfig({ model: "fake-smart" }));
  servers.push(app);

  test("GET /api/agent includes the planning part, independent of the analysis one", async () => {
    const r = await call<AgentResponse>(app, "GET", agentPaths.agent);
    expect(r.body.planning.harness).toEqual({ value: "custom", source: "config" });
    expect(r.body.planning.model).toEqual({ value: "fake-smart", source: "config" });
    expect(r.body.planning.effort).toEqual({ value: null, source: "default" });
    expect(r.body.planning.harnesses.map((h) => h.kind)).toEqual(["claude-code", "opencode", "custom"]);
  });

  test("PUT /api/agent/planning is checked against what the harness offers, and doesn't touch the analysis setting", async () => {
    const bad = await call<ApiError>(app, "PUT", agentPaths.planningAgent, {
      harness: "custom",
      model: "gpt-9",
      effort: null,
    });
    expect(bad.body.error).toBe("Custom agent doesn't offer the model gpt-9");

    const ok = await call<AgentResponse>(app, "PUT", agentPaths.planningAgent, {
      harness: "custom",
      model: "fake-smart",
      effort: "max",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.planning.model).toEqual({ value: "fake-smart", source: "app" });
    expect(ok.body.planning.effort).toEqual({ value: "max", source: "app" });
    // the analysis setting (a different key) is untouched
    expect(ok.body.model).toEqual({ value: null, source: "default" });
    expect(app.services.repos.settings.get("planning-agent")).toEqual({
      harness: "custom",
      model: "fake-smart",
      effort: "max",
    });
    expect(app.services.repos.settings.get("agent")).toBeNull();
  });

  test("the next planning round reads the saved setting", () => {
    expect(app.services.agent.forPlanning()).toMatchObject({ model: "fake-smart", effort: "max" });
  });
});

describe("env fixes values; OpenCode runs", () => {
  test("PUT keeps what the env fixes", async () => {
    const app = start(
      analysisConfig(
        { harness: "custom", command: process.execPath, args: [FAKE_AGENT] },
        { YAMT_ANALYSIS_HARNESS: "custom", YAMT_ANALYSIS_EFFORT: "high" },
      ),
    );
    servers.push(app);
    const r = await call<AgentResponse>(app, "PUT", agentPaths.agent, {
      harness: "claude-code",
      model: "fake-smart",
      effort: "low",
    });
    expect(r.status).toBe(200);
    expect(r.body.harness).toEqual({ value: "custom", source: "env", envVar: "YAMT_ANALYSIS_HARNESS" });
    expect(r.body.model).toEqual({ value: "fake-smart", source: "app" });
    expect(r.body.effort).toEqual({ value: "high", source: "env", envVar: "YAMT_ANALYSIS_EFFORT" });
    expect(app.services.repos.settings.get("agent")).toEqual({
      harness: "custom",
      model: "fake-smart",
      effort: null,
    });
  });

  test("an OpenCode run (the fake agent as its command) gets its instructions file, no ACP system prompt", async () => {
    const app = start(
      analysisConfig({ harness: "opencode", command: process.execPath, args: [FAKE_AGENT] }, {}),
    );
    servers.push(app);
    const run = await analyse(app);
    expect(run).toMatchObject({ status: "succeeded", harness: "opencode", requestedModel: null });
    const rec = record(app, run.id);
    expect(rec.systemPrompt).toBe("");
    const config = JSON.parse(rec.opencodeConfig!) as { instructions: string[] };
    expect(config.instructions).toHaveLength(1);
    expect(existsSync(config.instructions[0]!)).toBe(true);
    expect(readFileSync(config.instructions[0]!, "utf8")).toContain("# Log a meal");
  });
});
