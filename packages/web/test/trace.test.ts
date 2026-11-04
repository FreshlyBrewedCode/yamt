import { describe, expect, test } from "bun:test";
import { parseTrace, summariseInput, summariseResult, toolName } from "../src/lib/trace";

/** A made-up trace in the shape the server writes: run.start, ACP events, run.end. */
const line = (t: number, kind: string, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ t, at: 1_800_000_000_000 + t, kind, ...fields });
const update = (t: number, update: Record<string, unknown>) => line(t, "update", { update });
const chunk = (t: number, type: "agent_message_chunk" | "agent_thought_chunk", text: string) =>
  update(t, { sessionUpdate: type, content: { type: "text", text } });

const TRACE = [
  line(5, "run.start", {
    harness: "claude-code",
    model: "claude-opus-5-5",
    attempt: 2,
    skill: { path: "/x/SKILL.md", sha256: "abc123", text: "…" },
  }),
  line(10, "process.start", { command: "node", args: [], pid: 1 }),
  line(20, "config", { configId: "model", value: "fake", error: "not offered by the harness" }),
  chunk(100, "agent_thought_chunk", "Die Notiz nennt "),
  chunk(110, "agent_thought_chunk", "Haferflocken."),
  // claude-agent-acp: an empty input first, the full one in an update, the name in _meta
  update(200, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "mcp__yamt__search_foods",
    status: "pending",
    rawInput: {},
    _meta: { claudeCode: { toolName: "mcp__yamt__search_foods" } },
  }),
  update(210, { sessionUpdate: "tool_call_update", toolCallId: "t1", rawInput: { query: "Haferflocken" } }),
  update(1450, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: JSON.stringify({ candidates: [{ name: "Zarte Haferflocken" }, { name: "Oats" }] }),
        },
      },
    ],
  }),
  line(1500, "permission", {
    request: { toolCall: { title: "rm -rf /" } },
    toolName: "Bash",
    decision: "reject",
  }),
  update(1600, {
    sessionUpdate: "tool_call",
    toolCallId: "t2",
    title: "Fetch example.org",
    status: "pending",
    rawInput: { url: "https://example.org/rezept" },
    _meta: { claudeCode: { toolName: "WebFetch" } },
  }),
  update(2600, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t2",
    status: "failed",
    rawOutput: "HTTP 503",
  }),
  chunk(2700, "agent_message_chunk", "Gespeichert"),
  chunk(2710, "agent_message_chunk", "."),
  update(2720, {
    sessionUpdate: "usage_update",
    used: 1,
    size: 2,
    _meta: { "_claude/model": "claude-opus-5-5-x" },
  }),
  '{"t": 2800, "kind": "upd', // a line cut off by a crash
  line(2900, "process.exit", { code: 1, signal: null, stderr: "boom\n" }),
  line(3000, "run.end", {
    status: "failed",
    stopReason: "end_turn",
    error: "the agent ended its turn without calling save_meal_revision",
    usage: { totalTokens: 1500, inputTokens: 1200, outputTokens: 300, cachedReadTokens: 900 },
    context: { used: 10, size: 200, cost: { amount: 0.42, currency: "USD" } },
    durationMs: 2995,
  }),
].join("\n");

describe("parseTrace", () => {
  test("run metadata, joined chunks, tool calls with input, result and duration, errors", () => {
    const p = parseTrace(TRACE);
    expect(p.run).toEqual({
      harness: "claude-code",
      model: "claude-opus-5-5-x",
      attempt: 2,
      status: "failed",
      stopReason: "end_turn",
      durationMs: 2995,
      error: "the agent ended its turn without calling save_meal_revision",
      tokens: { input: 1200, output: 300, total: 1500, cachedRead: 900 },
      cost: { amount: 0.42, currency: "USD" },
      skillSha256: "abc123",
    });
    expect(p.skipped).toBe(1);
    expect(p.toolCalls).toBe(2);
    expect(p.items.map((i) => i.type)).toEqual([
      "notice",
      "thought",
      "tool",
      "permission",
      "tool",
      "message",
      "error",
      "error",
    ]);
    expect(p.items[1]).toMatchObject({ text: "Die Notiz nennt Haferflocken." });
    expect(p.items[2]).toMatchObject({
      name: "search_foods",
      title: null,
      inputSummary: "“Haferflocken”",
      status: "completed",
      resultSummary: "2 candidates · Zarte Haferflocken",
      durationMs: 1250,
    });
    expect(p.items[3]).toMatchObject({ tool: "Bash", decision: "reject" });
    expect(p.items[4]).toMatchObject({
      name: "WebFetch",
      title: "Fetch example.org",
      inputSummary: "https://example.org/rezept",
      status: "failed",
      result: "HTTP 503",
      resultSummary: "HTTP 503",
      durationMs: 1000,
    });
    expect(p.items[5]).toMatchObject({ text: "Gespeichert." });
    expect(p.items[6]).toMatchObject({ text: "the harness ended with exit code 1: boom" });
  });

  test("an empty or garbage trace gives an empty result, not an exception", () => {
    expect(parseTrace("")).toMatchObject({ items: [], toolCalls: 0, skipped: 0, run: { model: null } });
    expect(parseTrace("nope\n[1,2]\n").skipped).toBe(2);
  });

  test("a tool still running has no duration", () => {
    const p = parseTrace(
      update(10, {
        sessionUpdate: "tool_call",
        toolCallId: "x",
        title: "mcp__yamt__get_meal",
        status: "in_progress",
      }),
    );
    expect(p.items[0]).toMatchObject({
      name: "get_meal",
      status: "in_progress",
      durationMs: null,
      result: null,
    });
  });
});

describe("summaries", () => {
  test("tool names lose the MCP prefix", () => {
    expect(toolName("mcp__yamt__save_meal_revision")).toBe("save_meal_revision");
    expect(toolName("WebSearch")).toBe("WebSearch");
  });

  test("inputs of the yamt tools by their key fields", () => {
    expect(summariseInput("save_meal_revision", { title: "Curry", items: [{}, {}], questions: [{}] })).toBe(
      "Curry · 2 items · 1 question",
    );
    expect(
      summariseInput("create_food", {
        source: "label",
        name: "Kokosmilch",
        brand: "X",
        per100g: { energyKcal: 178 },
      }),
    ).toBe("label · Kokosmilch · X · 178 kcal/100 g");
    expect(summariseInput("Read", { file_path: "/data/runs/r/photo.1600.jpg" })).toBe("photo.1600.jpg");
    expect(summariseInput("other", { a: "x", b: 2, c: { d: 1 } })).toBe("x · 2");
    expect(summariseInput("other", { q: "a".repeat(200) })).toHaveLength(90);
  });

  test("results: the saved revision, foods, plain text", () => {
    const saved = JSON.stringify({
      mealStatus: "needs_input",
      revision: { number: 2, totals: { energyKcal: 711.6 } },
    });
    expect(summariseResult("save_meal_revision", saved, "completed")).toBe(
      "saved revision 2 · 712 kcal · needs input",
    );
    expect(
      summariseResult(
        "create_food",
        JSON.stringify({ name: "Kokosmilch", brand: null, per100g: { energyKcal: 178 } }),
        "completed",
      ),
    ).toBe("Kokosmilch · 178 kcal/100 g");
    expect(summariseResult("WebFetch", "line one\nline two", "completed")).toBe("line one line two");
    expect(summariseResult("x", null, "failed")).toBe("failed");
  });
});
