// A run's trace (`GET /api/runs/:id/trace`, NDJSON of `TraceEntry`) turned into something a
// phone can show: tool calls with a short input and result, the agent's messages and thoughts
// (streamed chunk by chunk, joined here), permission decisions and errors, plus the run's
// metadata from `run.start` / `run.end`. Pure, so it is tested without a browser.
import type { TraceEntry } from "@yamt/shared";

export interface TraceTool {
  type: "tool";
  id: string;
  /** Without the `mcp__yamt__` prefix: `search_foods`, `WebFetch`, … */
  name: string;
  /** The harness's own title when it says more than the name ("Read photo.jpg"). */
  title: string | null;
  input: unknown;
  /** One line: the query, the URL, "5 items · 1 question" … */
  inputSummary: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  /** The result as text (tool output joined), if there was one. */
  result: string | null;
  resultSummary: string | null;
  /** ms since the run started. */
  t: number;
  durationMs: number | null;
}

export type TraceItem =
  | TraceTool
  | { type: "message"; text: string; t: number }
  | { type: "thought"; text: string; t: number }
  | { type: "permission"; tool: string; decision: string; t: number }
  | { type: "error"; text: string; t: number }
  /** Something that went wrong without failing the run (a config option the harness lacks). */
  | { type: "notice"; text: string; t: number };

export interface TraceRun {
  harness: string | null;
  model: string | null;
  attempt: number | null;
  status: string | null;
  stopReason: string | null;
  durationMs: number | null;
  error: string | null;
  tokens: { input: number; output: number; total: number; cachedRead: number | null } | null;
  cost: { amount: number; currency: string } | null;
  /** The skill's hash at the time (which version of the instructions ran). */
  skillSha256: string | null;
}

export interface ParsedTrace {
  run: TraceRun;
  items: TraceItem[];
  toolCalls: number;
  /** Lines that weren't JSON (a run killed mid-write leaves half a line). */
  skipped: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parses NDJSON text into entries; lines that aren't a JSON object are counted, not thrown. */
export function parseNdjson(text: string): { entries: TraceEntry[]; skipped: number } {
  const entries: TraceEntry[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (isObj(v) && typeof v.kind === "string") entries.push(v as TraceEntry);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

const MCP_PREFIX = /^mcp__.+?__/;
/** `mcp__yamt__search_foods` → `search_foods`. */
export const toolName = (raw: string): string => raw.replace(MCP_PREFIX, "");

export function parseTrace(text: string): ParsedTrace {
  const { entries, skipped } = parseNdjson(text);
  const run: TraceRun = {
    harness: null,
    model: null,
    attempt: null,
    status: null,
    stopReason: null,
    durationMs: null,
    error: null,
    tokens: null,
    cost: null,
    skillSha256: null,
  };
  const items: TraceItem[] = [];
  const tools = new Map<string, TraceTool>();

  const append = (type: "message" | "thought", chunk: string, t: number) => {
    const last = items.at(-1);
    if (last?.type === type) last.text += chunk;
    else items.push({ type, text: chunk, t });
  };

  for (const e of entries) {
    switch (e.kind) {
      case "run.start":
        run.harness = str(e.harness);
        run.model = str(e.model);
        run.attempt = num(e.attempt);
        run.skillSha256 = isObj(e.skill) ? str(e.skill.sha256) : null;
        break;
      case "run.end": {
        run.status = str(e.status);
        run.stopReason = str(e.stopReason);
        run.durationMs = num(e.durationMs);
        run.error = str(e.error);
        const u = isObj(e.usage) ? e.usage : null;
        if (u) {
          run.tokens = {
            input: num(u.inputTokens) ?? 0,
            output: num(u.outputTokens) ?? 0,
            total: num(u.totalTokens) ?? 0,
            cachedRead: num(u.cachedReadTokens),
          };
        }
        const cost = isObj(e.context) && isObj(e.context.cost) ? e.context.cost : null;
        if (cost && num(cost.amount) !== null) {
          run.cost = { amount: num(cost.amount)!, currency: str(cost.currency) ?? "USD" };
        }
        if (run.error) items.push({ type: "error", text: run.error, t: e.t });
        break;
      }
      case "update": {
        if (!isObj(e.update)) break;
        const u = e.update;
        const kind = str(u.sessionUpdate);
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
          const c = isObj(u.content) ? u.content : null;
          const chunk = c && c.type === "text" ? str(c.text) : null;
          if (chunk) append(kind === "agent_message_chunk" ? "message" : "thought", chunk, e.t);
        } else if (kind === "usage_update") {
          // claude-agent-acp reports the answering model here
          const meta = isObj(u._meta) ? str(u._meta["_claude/model"]) : null;
          if (meta) run.model = meta;
          const cost = isObj(u.cost) ? u.cost : null;
          if (cost && num(cost.amount) !== null && !run.cost) {
            run.cost = { amount: num(cost.amount)!, currency: str(cost.currency) ?? "USD" };
          }
        } else if (kind === "tool_call" || kind === "tool_call_update") {
          const id = str(u.toolCallId);
          if (!id) break;
          let tool = tools.get(id);
          if (!tool) {
            tool = {
              type: "tool",
              id,
              name: "tool",
              title: null,
              input: undefined,
              inputSummary: "",
              status: "pending",
              result: null,
              resultSummary: null,
              t: e.t,
              durationMs: null,
            };
            tools.set(id, tool);
            items.push(tool);
          }
          const meta = isObj(u._meta) && isObj(u._meta.claudeCode) ? str(u._meta.claudeCode.toolName) : null;
          const rawName = meta ?? str(u.name) ?? null;
          const title = str(u.title);
          if (rawName) tool.name = toolName(rawName);
          else if (title && tool.name === "tool") tool.name = toolName(title);
          if (title && toolName(title) !== tool.name) tool.title = title;
          if ("rawInput" in u && u.rawInput !== undefined && !isEmpty(u.rawInput)) tool.input = u.rawInput;
          const status = str(u.status);
          if (
            status === "pending" ||
            status === "in_progress" ||
            status === "completed" ||
            status === "failed"
          ) {
            tool.status = status;
            if ((status === "completed" || status === "failed") && tool.durationMs === null) {
              tool.durationMs = Math.max(0, e.t - tool.t);
            }
          }
          const out = resultText(u);
          if (out !== null) tool.result = out;
        }
        break;
      }
      case "permission": {
        const req = isObj(e.request) && isObj(e.request.toolCall) ? e.request.toolCall : null;
        const name = str(e.toolName) ?? str(req?.title) ?? "a tool";
        items.push({ type: "permission", tool: toolName(name), decision: str(e.decision) ?? "?", t: e.t });
        break;
      }
      case "config":
        if (str(e.error))
          items.push({ type: "notice", text: `config ${str(e.configId)}: ${str(e.error)}`, t: e.t });
        break;
      case "cancel":
        items.push({ type: "error", text: `cancelled (${str(e.reason) ?? "?"})`, t: e.t });
        break;
      case "process.exit": {
        const code = num(e.code);
        const stderr = str(e.stderr)?.trim();
        if ((code !== null && code !== 0) || str(e.signal)) {
          const how = code !== null ? `exit code ${code}` : `signal ${str(e.signal)}`;
          items.push({
            type: "error",
            text: `the harness ended with ${how}${stderr ? `: ${tail(stderr)}` : ""}`,
            t: e.t,
          });
        }
        break;
      }
    }
  }

  for (const tool of tools.values()) {
    tool.inputSummary = summariseInput(tool.name, tool.input);
    tool.resultSummary = summariseResult(tool.name, tool.result, tool.status);
  }
  for (const item of items) if ("text" in item) item.text = item.text.trim();
  return {
    run,
    items: items.filter((i) => !("text" in i) || i.text !== ""),
    toolCalls: tools.size,
    skipped,
  };
}

const isEmpty = (v: unknown) => isObj(v) && Object.keys(v).length === 0;
const tail = (s: string, n = 300) => (s.length > n ? `…${s.slice(-n)}` : s);
const clip = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** The text a tool call produced: ACP `content` blocks, else `rawOutput`. */
function resultText(u: Obj): string | null {
  const parts: string[] = [];
  if (Array.isArray(u.content)) {
    for (const c of u.content) {
      if (!isObj(c)) continue;
      if (c.type === "content" && isObj(c.content) && c.content.type === "text") {
        const t = str(c.content.text);
        if (t) parts.push(t);
      } else if (c.type === "diff") {
        parts.push(`diff ${str(c.path) ?? ""}`);
      }
    }
  }
  if (parts.length) return parts.join("\n");
  const raw = u.rawOutput;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const texts = raw.flatMap((b) => (isObj(b) && typeof b.text === "string" ? [b.text] : []));
    if (texts.length) return texts.join("\n");
  }
  if (raw !== undefined && raw !== null) return JSON.stringify(raw);
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line about what a tool was asked: the known yamt tools by their key field, else the first strings. */
export function summariseInput(name: string, input: unknown): string {
  if (!isObj(input)) return typeof input === "string" ? clip(input) : "";
  switch (name) {
    case "get_meal":
      return "the meal";
    case "search_foods":
      return clip(`“${str(input.query) ?? ""}”`);
    case "lookup_barcode":
      return str(input.barcode) ?? "";
    case "get_food":
      return `food ${short(str(input.foodId))}`;
    case "create_food":
      return clip(
        [str(input.source), str(input.name), str(input.brand)].filter(Boolean).join(" · ") +
          (isObj(input.per100g) && num(input.per100g.energyKcal) !== null
            ? ` · ${num(input.per100g.energyKcal)} kcal/100 g`
            : ""),
      );
    case "fetch_recipe":
    case "WebFetch":
      return clip(str(input.url) ?? "");
    case "WebSearch":
      return clip(`“${str(input.query) ?? ""}”`);
    case "Read":
      return clip((str(input.file_path) ?? "").split("/").pop() ?? "");
    case "save_meal_revision": {
      const items = Array.isArray(input.items) ? input.items.length : 0;
      const qs = Array.isArray(input.questions) ? input.questions.length : 0;
      return clip(
        [str(input.title), plural(items, "item"), qs ? plural(qs, "question") : null]
          .filter(Boolean)
          .join(" · "),
      );
    }
    case "get_day_summary":
      return str(input.date) ?? "";
  }
  const strings = Object.values(input).filter(
    (v): v is string | number => typeof v === "string" || typeof v === "number",
  );
  return clip(strings.join(" · "));
}

const short = (id: string | null) => (id ? id.slice(-6) : "?");

/** One line about what came back: counts and names for the yamt tools, else the first line. */
export function summariseResult(
  name: string,
  result: string | null,
  status: TraceTool["status"],
): string | null {
  if (result === null) return status === "failed" ? "failed" : null;
  if (status === "failed") return clip(result, 140);
  let data: unknown;
  try {
    data = JSON.parse(result);
  } catch {
    return clip(result, 120);
  }
  if (!isObj(data)) return Array.isArray(data) ? plural(data.length, "result") : clip(result, 120);
  switch (name) {
    case "search_foods": {
      const c = Array.isArray(data.candidates) ? data.candidates : null;
      if (c) {
        const first = isObj(c[0]) ? str(c[0].name) : null;
        return clip(`${plural(c.length, "candidate")}${first ? ` · ${first}` : ""}`);
      }
      break;
    }
    case "get_meal": {
      const caps = Array.isArray(data.captures) ? data.captures.length : null;
      if (caps !== null) return plural(caps, "capture");
      break;
    }
    case "save_meal_revision": {
      const rev = isObj(data.revision) ? data.revision : null;
      const kcal = rev && isObj(rev.totals) ? num(rev.totals.energyKcal) : null;
      const status = str(data.mealStatus);
      return [
        rev && num(rev.number) !== null ? `saved revision ${num(rev.number)}` : "saved",
        kcal !== null ? `${Math.round(kcal)} kcal` : null,
        status?.replace("_", " "),
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
  if (str(data.name)) {
    const kcal = isObj(data.per100g) ? num(data.per100g.energyKcal) : null;
    return clip(
      [str(data.name), str(data.brand), kcal !== null ? `${kcal} kcal/100 g` : null]
        .filter(Boolean)
        .join(" · "),
    );
  }
  return clip(result, 120);
}
