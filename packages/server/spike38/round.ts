#!/usr/bin/env bun
// SPIKE #38: run one planning round over ACP the way analysis/job.ts runs an analysis, and print
// a timing summary from its trace.
//
//   bun packages/server/spike38/round.ts --data-dir /tmp/yamt-spike38 --port 7961 \
//     --request pumpkin|tue-thu [--mode real|based_on|free] [--count 3] [--model claude-opus-5-5]
//     [--effort low|medium|high|…] [--no-matcher] [--prev <roundId>] [--steer "…"] [--label …]
//
// The round's request goes to <data>/planning/rounds/<id>/request.json, the trace next to it
// (trace.ndjson, the MCP token redacted), what the agent saved to outline.json / suggestions.json.
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { addDays } from "@yamt/shared";
import { adapters } from "../src/acp/adapters/index.ts";
import { httpMcpServer } from "../src/acp/mcp.ts";
import { type PromptRunResult, runPrompt } from "../src/acp/run.ts";
import { analysisPermissions, WEB_TOOLS } from "../src/analysis/permissions.ts";
import { loadSkill } from "../src/analysis/skill.ts";
import { TraceWriter } from "../src/analysis/trace.ts";
import { newId } from "../src/db/index.ts";
import { localDate, localTimeZone } from "../src/domain/time.ts";
import { type PlanningRequest, PlanningStore, type SourceMode } from "../src/planning/store.ts";
import { summarise } from "./summary.ts";

const { values: a } = parseArgs({
  options: {
    "data-dir": { type: "string", default: "/tmp/yamt-spike38" },
    port: { type: "string", default: "7961" },
    request: { type: "string", default: "pumpkin" },
    mode: { type: "string", default: "based_on" },
    count: { type: "string", default: "3" },
    model: { type: "string", default: "claude-opus-5-5" },
    effort: { type: "string" },
    "no-matcher": { type: "boolean", default: false },
    prev: { type: "string" },
    steer: { type: "string" },
    label: { type: "string" },
    "turn-min": { type: "string", default: "30" },
  },
});

const dataDir = a["data-dir"]!;
const store = new PlanningStore(dataDir);
const tz = localTimeZone();
const today = localDate(Date.now(), tz);
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
const nextDow = (dow: number) => addDays(today, (dow - weekday + 7) % 7 || 7);

const base = {
  constraints: [] as string[],
  useUpLeftovers: [] as string[],
  timeCapMinutes: null as number | null,
};
const presets: Record<
  string,
  { text: string; filters: Omit<PlanningRequest["filters"], "sourceMode" | "count"> }
> = {
  pumpkin: {
    text: "Irgendwas mit dem restlichen Kürbis, heute Abend. Kein Ofen.",
    filters: {
      ...base,
      slots: [{ date: today, slot: "dinner" }],
      constraints: ["kein Ofen"],
      useUpLeftovers: ["½ Hokkaido-Kürbis"],
      timeCapMinutes: 45,
      portionsToCook: 1,
    },
  },
  "tue-thu": {
    text: "Abendessen Dienstag bis Donnerstag, höchstens 40 Minuten.",
    filters: {
      ...base,
      slots: [2, 3, 4].map((d) => ({ date: nextDow(d), slot: "dinner" as const })),
      timeCapMinutes: 40,
      portionsToCook: 2,
    },
  },
};
const preset = presets[a.request!];
if (!preset) throw new Error(`unknown request ${a.request}`);

const roundId = `r-${newId().slice(-12)}`;
const prev = a.prev ? [...(store.request(a.prev)?.previousRounds ?? []), a.prev] : [];
const request: PlanningRequest = {
  text: preset.text,
  filters: { ...preset.filters, sourceMode: a.mode as SourceMode, count: Number(a.count) },
  previousRounds: prev,
  steer: a.steer ?? null,
  createdAt: Date.now(),
};
store.setRequest(roundId, request);

const roundDir = join(store.dir, "rounds", roundId);
const cwd = join(roundDir, "run");
await mkdir(cwd, { recursive: true, mode: 0o700 });
const token = readFileSync(join(dataDir, "mcp-token"), "utf8").trim();
const skill = await loadSkill(join(import.meta.dir, "../../../.agents/skills/plan-meals/SKILL.md"));
const mcpUrl = `http://127.0.0.1:${a.port}/mcp${a["no-matcher"] ? "?hide=match_ingredients" : ""}`;
const startedAt = Date.now();
const trace = new TraceWriter(join(roundDir, "trace.ndjson"), startedAt, [token]);
const config = {
  roundId,
  label: a.label ?? null,
  request: a.request,
  mode: a.mode,
  count: Number(a.count),
  model: a.model,
  effort: a.effort ?? null,
  matcher: !a["no-matcher"],
  prev: a.prev ?? null,
  steer: a.steer ?? null,
};
trace.write("run.start", { ...config, skill: { sha256: skill.sha256 } });
console.log(`round ${roundId}`, config);

const prompt = [
  `Planning round ${roundId}: suggest ${request.filters.count} meals for the request in get_planning_context (roundId "${roundId}").`,
  request.steer ? `This round steers from earlier rounds: "${request.steer}".` : "",
  "Follow the plan-meals instructions: context, outline, then one suggestion at a time.",
]
  .filter(Boolean)
  .join("\n");

let result: PromptRunResult;
try {
  result = await runPrompt({
    harness: { kind: "claude-code", command: "", args: [], env: {} },
    adapter: adapters["claude-code"],
    cwd,
    systemPrompt: skill.text,
    model: a.model!,
    effort: a.effort ?? null,
    mcp: {
      servers: [httpMcpServer("yamt", mcpUrl, token)],
      allowedTools: ["mcp__yamt", ...WEB_TOOLS],
      credential: { server: "yamt", token },
    },
    builtInTools: [...WEB_TOOLS],
    isolated: true,
    prompt: () => [{ type: "text", text: prompt }],
    permission: analysisPermissions(() => false),
    onEvent: (e) => trace.event(e),
    timeouts: { turnMs: Number(a["turn-min"]) * 60_000, idleMs: 5 * 60_000 },
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
trace.write("run.end", {
  status: result.status,
  stopReason: result.stopReason,
  error: result.error,
  model: result.model,
  effort: result.effort,
  configNotes: result.configNotes,
  usage: result.usage,
  context: result.context,
  durationMs: Date.now() - startedAt,
});
console.log(`status ${result.status} (${result.stopReason ?? result.error})`);
console.log(JSON.stringify(summarise(join(roundDir, "trace.ndjson"), store, roundId), null, 1));
