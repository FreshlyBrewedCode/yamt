import type { AnalysisRun } from "@yamt/shared";
import { cn } from "cn";
import { useState } from "react";
import { formatElapsed, formatNumber, formatTime } from "@/lib/format";
import { useTrace } from "@/lib/queries";
import type { TraceItem, TraceTool } from "@/lib/trace";
import { Label } from "./slab";

const runStatusText: Record<AnalysisRun["status"], string> = {
  running: "Running",
  succeeded: "Saved a revision",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** "7.7 s · claude-opus-5-5" for a disclosure's meta. */
export function runMeta(run: AnalysisRun): string {
  const parts = [
    run.endedAt !== null ? formatElapsed(run.endedAt - run.startedAt) : "running",
    run.model,
    run.status === "failed" ? "failed" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * One analysis run: what ran (model, harness, attempt), how it ended, what it cost, then its
 * trace as a list a phone can read: tool calls (name, input, result, duration; tap for the full
 * input and output), the agent's messages and thoughts, permission decisions, errors. The trace
 * is fetched when this mounts (inside a closed Disclosure it doesn't), and polled while the run
 * runs.
 */
export function TraceView({ run }: { run: AnalysisRun }) {
  const trace = useTrace(run.id, true, run.status === "running");
  const t = trace.data;
  const turn = run.usage?.turn;
  const tokens = turn ? { input: turn.inputTokens, output: turn.outputTokens } : (t?.run.tokens ?? null);
  const cost = t?.run.cost ?? run.usage?.context?.cost ?? null;
  const facts: [string, string][] = [
    ["Model", run.model ?? t?.run.model ?? "—"],
    ["Harness", run.harness],
    ["Started", `${formatTime(run.startedAt)}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}`],
    ["Took", run.endedAt !== null ? formatElapsed(run.endedAt - run.startedAt) : "running…"],
    ["Outcome", runStatusText[run.status]],
    ["Stop reason", run.stopReason ?? "—"],
    ["Tokens", tokens ? `${formatNumber(tokens.input)} in · ${formatNumber(tokens.output)} out` : "—"],
    ["Cost", cost ? `${cost.amount.toFixed(2)} ${cost.currency}` : "—"],
  ];

  return (
    <div className="bg-tint" data-testid="trace">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pt-3 pb-4">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt>
              <Label className="text-[10px] text-muted-foreground">{k}</Label>
            </dt>
            <dd className="truncate font-bold text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      {run.error && (
        <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
          {run.error}
        </p>
      )}
      {trace.isPending ? (
        <p className="px-5 py-4 font-medium text-muted-foreground text-sm">Loading the trace…</p>
      ) : trace.isError ? (
        <p className="px-5 py-4 font-medium text-muted-foreground text-sm">
          No trace to show: {trace.error.message}
        </p>
      ) : t && t.items.length === 0 ? (
        <p className="px-5 py-4 font-medium text-muted-foreground text-sm">The trace is empty.</p>
      ) : (
        t && (
          <>
            <Label className="border-border border-t px-5 pt-3 pb-1 text-muted-foreground">
              {t.toolCalls} tool {t.toolCalls === 1 ? "call" : "calls"}
              {t.skipped > 0 && ` · ${t.skipped} unreadable lines`}
            </Label>
            <ol className="divide-y divide-border" data-testid="trace-items">
              {t.items.map((item, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the trace is append-only; positions are stable
                <TraceRow key={i} item={item} />
              ))}
            </ol>
          </>
        )
      )}
    </div>
  );
}

function TraceRow({ item }: { item: TraceItem }) {
  const [open, setOpen] = useState(false);
  switch (item.type) {
    case "tool":
      return <ToolRow tool={item} />;
    case "message":
    case "thought":
      return (
        <li data-testid={`trace-${item.type}`}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="block min-h-11 w-full px-5 py-2.5 text-left outline-none focus-visible:bg-background/50"
          >
            <Label className={item.type === "thought" ? "text-muted-foreground" : undefined}>
              {item.type === "message" ? "Agent" : "Thinking"}
            </Label>
            <p
              className={cn(
                "mt-0.5 whitespace-pre-wrap break-words font-medium text-sm",
                item.type === "thought" && "text-muted-foreground",
                !open && (item.type === "thought" ? "line-clamp-2" : "line-clamp-4"),
              )}
            >
              {item.text}
            </p>
          </button>
        </li>
      );
    case "permission":
      return (
        <li className="flex min-h-11 items-center px-5 py-2.5 text-sm" data-testid="trace-permission">
          <span>
            <Label className="inline text-muted-foreground">Permission</Label>{" "}
            <span className="font-bold">{item.tool}</span>{" "}
            <span className="font-medium text-muted-foreground">
              {item.decision === "allow" ? "allowed" : item.decision === "reject" ? "refused" : item.decision}
            </span>
          </span>
        </li>
      );
    case "notice":
      return (
        <li className="px-5 py-2.5" data-testid="trace-notice">
          <Label className="text-muted-foreground">Note</Label>
          <p className="mt-0.5 break-words font-medium text-muted-foreground text-sm">{item.text}</p>
        </li>
      );
    case "error":
      return (
        <li className="bg-orange px-5 py-2.5 text-orange-foreground" data-testid="trace-error">
          <Label>Error</Label>
          <p className="mt-0.5 whitespace-pre-wrap break-words font-bold text-sm">{item.text}</p>
        </li>
      );
  }
}

function ToolRow({ tool }: { tool: TraceTool }) {
  const [open, setOpen] = useState(false);
  const failed = tool.status === "failed";
  const running = tool.status === "pending" || tool.status === "in_progress";
  return (
    <li data-testid="trace-tool" data-tool={tool.name} data-status={tool.status}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="block min-h-11 w-full px-5 py-2.5 text-left outline-none focus-visible:bg-background/50"
      >
        <div className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-bold">{tool.name}</span>{" "}
            <span className="font-medium text-muted-foreground">{tool.inputSummary}</span>
          </span>
          <span className="shrink-0 font-medium text-muted-foreground text-xs">
            {running ? "running" : tool.durationMs !== null ? formatElapsed(tool.durationMs) : ""}
          </span>
        </div>
        {(tool.resultSummary || failed) && (
          <p className="mt-0.5 flex items-baseline gap-1.5 font-medium text-sm">
            {failed && <span className="size-2 shrink-0 self-center bg-orange" aria-hidden />}
            <span className={cn("truncate", !failed && "text-muted-foreground")}>
              {failed ? "Failed: " : "→ "}
              {tool.resultSummary ?? ""}
            </span>
          </p>
        )}
      </button>
      {open && (
        <div className="space-y-2 px-5 pb-3" data-testid="trace-tool-detail">
          {tool.title && <p className="font-medium text-muted-foreground text-xs">{tool.title}</p>}
          <Payload
            label="Input"
            value={tool.input === undefined ? "—" : JSON.stringify(tool.input, null, 2)}
          />
          <Payload label={failed ? "Error" : "Result"} value={pretty(tool.result)} />
        </div>
      )}
    </li>
  );
}

function Payload({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <pre className="mt-1 max-h-72 overflow-auto font-[inherit] whitespace-pre-wrap break-words bg-background p-2 text-xs leading-snug">
        {value}
      </pre>
    </div>
  );
}

/** JSON results indented; anything else as it is. */
function pretty(result: string | null): string {
  if (result === null) return "—";
  try {
    return JSON.stringify(JSON.parse(result), null, 2);
  } catch {
    return result;
  }
}
