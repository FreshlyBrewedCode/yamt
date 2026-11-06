// SPIKE #38: a round's timing summary from its trace (and what it saved).
//   bun packages/server/spike38/summary.ts <data-dir> <roundId>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanningStore } from "../src/planning/store.ts";

interface Line {
  t: number;
  kind: string;
  update?: Record<string, unknown>;
  [k: string]: unknown;
}

interface Call {
  id: string;
  name: string;
  start: number;
  end: number | null;
  status: string | null;
  input: unknown;
}

const s = (ms: number | null | undefined) => (ms == null ? null : Math.round(ms / 100) / 10);

export function summarise(tracePath: string, store: PlanningStore, roundId: string) {
  const lines = readFileSync(tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
  const t0 = lines.find((l) => l.kind === "prompt")?.t ?? 0;
  const calls = new Map<string, Call>();
  let firstChunk: number | null = null;
  let cost: unknown = null;
  for (const l of lines) {
    if (l.kind !== "update" || !l.update) continue;
    const u = l.update as Record<string, unknown> & { _meta?: { claudeCode?: { toolName?: string } } };
    if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "agent_thought_chunk") {
      firstChunk ??= l.t;
    }
    if (u.sessionUpdate === "usage_update") cost = u.cost ?? cost;
    if (u.sessionUpdate !== "tool_call" && u.sessionUpdate !== "tool_call_update") continue;
    const id = u.toolCallId as string;
    const name = u._meta?.claudeCode?.toolName ?? (u.title as string | undefined) ?? "?";
    let c = calls.get(id);
    if (!c) {
      c = { id, name, start: l.t, end: null, status: null, input: null };
      calls.set(id, c);
    }
    if (u._meta?.claudeCode?.toolName) c.name = u._meta.claudeCode.toolName;
    if (u.rawInput && Object.keys(u.rawInput as object).length) c.input = u.rawInput;
    if (u.status === "completed" || u.status === "failed") {
      c.end = l.t;
      c.status = u.status as string;
    }
  }
  const list = [...calls.values()].sort((x, y) => x.start - y.start);
  const short = (n: string) => n.replace(/^mcp__yamt__/, "");
  const byTool: Record<string, { n: number; totalS: number; maxS: number; failed: number }> = {};
  for (const c of list) {
    const k = short(c.name);
    const d = c.end === null ? 0 : c.end - c.start;
    const b = (byTool[k] ??= { n: 0, totalS: 0, maxS: 0, failed: 0 });
    b.n += 1;
    b.totalS = Math.round((b.totalS + d / 1000) * 10) / 10;
    b.maxS = Math.max(b.maxS, s(d) ?? 0);
    if (c.status === "failed") b.failed += 1;
  }
  const done = (name: string, pred: (c: Call) => boolean = () => true) =>
    list
      .filter((c) => short(c.name) === name && c.status === "completed" && pred(c))
      .map((c) => s((c.end ?? 0) - t0));
  const end = lines.find((l) => l.kind === "run.end") as
    | (Line & { usage?: Record<string, number>; durationMs?: number; model?: string; effort?: string })
    | undefined;
  const promptEnd = lines.find((l) => l.kind === "prompt.end")?.t ?? null;
  const toolSeconds = list.reduce((a, c) => a + (c.end === null ? 0 : c.end - c.start), 0);
  const outline = store.outline<{ ideas: { title: string; proposedSlot: unknown; sourceUrl?: string }[] }>(
    roundId,
  );
  const sugg = store.suggestions<{
    title: string;
    timeMinutes: number;
    sourceMode: string;
    sourceUrl?: string;
    perPortion: Record<string, number>;
    fit: Record<string, { portion: number; budget: number | null }>;
    ingredients: { description: string; grams: number; food: { name: string; source: string } | null }[];
  }>(roundId);
  return {
    roundId,
    model: end?.model,
    effort: end?.effort,
    firstOutputS: s(firstChunk === null ? null : firstChunk - t0),
    outlineS: done("save_round_outline")[0] ?? null,
    suggestionsS: done("save_suggestion", (c) => !(c.input as { dryRun?: boolean } | null)?.dryRun),
    turnS: s(promptEnd === null ? null : promptEnd - t0),
    wholeRunS: s(end?.durationMs),
    toolTimeS: s(toolSeconds),
    toolCalls: list.length,
    byTool,
    usage: end?.usage ?? null,
    cost,
    sequence: list.map(
      (c) =>
        `${s(c.start - t0)}→${s(c.end === null ? null : c.end - t0)} ${short(c.name)}${c.status === "failed" ? " FAILED" : ""}`,
    ),
    outline:
      outline?.ideas.map(
        (i) => `${i.title} @ ${JSON.stringify(i.proposedSlot)}${i.sourceUrl ? ` (${i.sourceUrl})` : ""}`,
      ) ?? null,
    suggestions: sugg.map((x) => ({
      title: x.title,
      time: x.timeMinutes,
      mode: x.sourceMode,
      url: x.sourceUrl ?? null,
      perPortion: x.perPortion,
      fit: Object.fromEntries(Object.entries(x.fit).map(([k, v]) => [k, `${v.portion}/${v.budget}`])),
      ingredients: x.ingredients.map(
        (i) => `${i.grams} g ${i.description} → ${i.food ? `${i.food.name} [${i.food.source}]` : "ESTIMATE"}`,
      ),
    })),
  };
}

if (import.meta.main) {
  const [dataDir, roundId] = process.argv.slice(2);
  if (!dataDir || !roundId) throw new Error("usage: summary.ts <data-dir> <roundId>");
  const store = new PlanningStore(dataDir);
  console.log(
    JSON.stringify(summarise(join(store.dir, "rounds", roundId, "trace.ndjson"), store, roundId), null, 1),
  );
}
