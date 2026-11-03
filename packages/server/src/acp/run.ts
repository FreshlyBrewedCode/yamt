import { existsSync } from "node:fs";
import { type HarnessAdapter, type HarnessConfig, launchSpec } from "./adapters/index.ts";
import type { McpSetup } from "./mcp.ts";
import { AcpProcess, ExitError, raceExit, SpawnError, withTimeout } from "./process.ts";
import * as acp from "./protocol.ts";

/**
 * One job turn over ACP: spawn the harness, `initialize`, one fresh `session/new`, one
 * `session/prompt`, then stop the process group. Trimmed from vibe-center's `AgentRuntime` for
 * background jobs: no resume, no queue, no presence. Like it, this knows nothing about storage or
 * HTTP; callers get every protocol event through `onEvent` and a `PromptRunResult` at the end.
 */

export interface RunTimeouts {
  initMs: number;
  sessionMs: number;
  /** Cancel the turn after this long without any session/update while no tool runs. */
  idleMs: number;
  /** The same while a tool call is open (a slow web fetch). */
  toolIdleMs: number;
  /** Hard cap on the whole prompt turn. */
  turnMs: number;
  /** After session/cancel, how long the harness gets to end the turn before it is killed. */
  cancelGraceMs: number;
}

export const DEFAULT_RUN_TIMEOUTS: RunTimeouts = {
  initMs: 30_000,
  sessionMs: 60_000,
  idleMs: 3 * 60_000,
  toolIdleMs: 5 * 60_000,
  turnMs: 10 * 60_000,
  cancelGraceMs: 5_000,
};

export type RunEvent =
  | { type: "process.start"; command: string; args: string[]; pid: number | undefined }
  | { type: "initialize"; response: acp.InitializeResponse }
  | { type: "session.new"; request: acp.NewSessionRequest; response: acp.NewSessionResponse }
  | { type: "config"; configId: string; value: string; error: string | null }
  | { type: "prompt"; prompt: acp.ContentBlock[] }
  | { type: "update"; update: acp.SessionUpdate }
  | {
      type: "permission";
      request: acp.RequestPermissionRequest;
      toolName: string | null;
      decision: PermissionDecision;
      outcome: acp.RequestPermissionOutcome;
    }
  | { type: "cancel"; reason: CancelReason }
  | { type: "prompt.end"; response: acp.PromptResponse }
  | { type: "notification"; method: string; params: unknown }
  | { type: "process.exit"; code: number | null; signal: string | null; stderr: string };

export type PermissionDecision = "allow" | "reject" | "cancel";

/**
 * Decides a permission request on the spot (a job has nobody to ask). `toolName` is the
 * harness's own tool name when it reported one (Claude Code's `_meta.claudeCode.toolName`, on
 * the request or the tool call it belongs to).
 */
export type PermissionPolicy = (
  request: acp.RequestPermissionRequest,
  toolName: string | null,
) => PermissionDecision;

type CancelReason = "idle" | "turn_limit" | "aborted";

export interface PromptRunOptions {
  harness: HarnessConfig;
  adapter: HarnessAdapter;
  /** The session's working directory (exists). */
  cwd: string;
  /** Extra process env. */
  env?: Record<string, string>;
  systemPrompt: string;
  model: string | null;
  mcp: McpSetup;
  builtInTools?: string[] | null;
  isolated?: boolean;
  /** The prompt, built once the harness's capabilities are known (e.g. image support). */
  prompt(capabilities: acp.AgentCapabilities): Promise<acp.ContentBlock[]> | acp.ContentBlock[];
  permission: PermissionPolicy;
  onEvent(event: RunEvent): void;
  timeouts?: Partial<RunTimeouts>;
  /** Aborting cancels the turn (server shutdown). */
  signal?: AbortSignal;
}

/** Why a run did not complete, for retry decisions. */
export type RunFailure = "not_installed" | "auth" | "timeout" | "crash" | "error";

export interface PromptRunResult {
  status: "complete" | "cancelled" | "error";
  stopReason: acp.StopReason | null;
  error: string | null;
  failure: RunFailure | null;
  /** The turn's token usage, if the harness reports it (`PromptResponse.usage`). */
  usage: acp.Usage | null;
  /** The last `usage_update`: context used and size, cumulative cost. */
  context: { used: number; size: number; cost: acp.Cost | null } | null;
  agentInfo: acp.Implementation | null;
  /**
   * The model that answered as the harness reports it (Claude Code: `_claude/model` on usage
   * updates; custom harnesses: their model config option), else the one asked for.
   */
  model: string | null;
}

class Abandoned extends Error {}

export async function runPrompt(opts: PromptRunOptions): Promise<PromptRunResult> {
  const t: RunTimeouts = { ...DEFAULT_RUN_TIMEOUTS, ...opts.timeouts };
  const emit = (e: RunEvent) => {
    try {
      opts.onEvent(e);
    } catch (err) {
      console.error("acp run event handler failed", err);
    }
  };

  let proc: AcpProcess | null = null;
  let sessionId: string | null = null;
  let lastActivity = Date.now();
  let cancelReason: CancelReason | null = null;
  const toolNames = new Map<string, string>();
  const openTools = new Set<string>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let context: PromptRunResult["context"] = null;
  let agentInfo: acp.Implementation | null = null;
  let model = opts.model;

  let abandon!: (e: Error) => void;
  const abandoned = new Promise<never>((_, reject) => {
    abandon = reject;
  });
  abandoned.catch(() => {});

  const cancel = (reason: CancelReason) => {
    if (cancelReason) return;
    cancelReason = reason;
    emit({ type: "cancel", reason });
    const p = proc;
    if (!sessionId || !p?.alive) {
      abandon(new Abandoned());
      return;
    }
    void p.agent.notify("session/cancel", { sessionId }).catch(() => {});
    // a harness that ignores the cancel is stopped (close() in finally kills the group)
    timers.push(setTimeout(() => abandon(new Abandoned()), t.cancelGraceMs));
  };
  const onAbort = () => cancel("aborted");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const handlers = {
    onUpdate(n: acp.SessionNotification) {
      if (sessionId !== null && n.sessionId !== sessionId) return;
      lastActivity = Date.now();
      const u = n.update;
      if (u.sessionUpdate === "tool_call") {
        const name = metaToolName(u._meta);
        if (name) toolNames.set(u.toolCallId, name);
        if (u.status !== "completed" && u.status !== "failed") openTools.add(u.toolCallId);
      } else if (u.sessionUpdate === "tool_call_update") {
        const name = metaToolName(u._meta);
        if (name) toolNames.set(u.toolCallId, name);
        if (u.status === "completed" || u.status === "failed") openTools.delete(u.toolCallId);
        else if (u.status === "in_progress" || u.status === "pending") openTools.add(u.toolCallId);
      } else if (u.sessionUpdate === "usage_update") {
        context = { used: u.used, size: u.size, cost: u.cost ?? null };
        // claude-agent-acp names the model that answered; its model config option can be stale
        const answered = (u._meta as Record<string, unknown> | null | undefined)?.["_claude/model"];
        if (typeof answered === "string") model = answered;
      }
      emit({ type: "update", update: u });
    },
    async onPermission(req: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
      lastActivity = Date.now();
      const toolName = metaToolName(req.toolCall._meta) ?? toolNames.get(req.toolCall.toolCallId) ?? null;
      let decision: PermissionDecision = "cancel";
      if (!cancelReason && (sessionId === null || req.sessionId === sessionId)) {
        try {
          decision = opts.permission(req, toolName);
        } catch (e) {
          console.error("permission policy failed", e);
        }
      }
      const optionId = decision === "cancel" ? null : pickOption(req.options, decision);
      const outcome: acp.RequestPermissionOutcome =
        optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId };
      emit({ type: "permission", request: req, toolName, decision, outcome });
      return { outcome };
    },
    onOtherNotification(method: string, params: unknown) {
      emit({ type: "notification", method, params });
    },
  };

  const result = (r: Partial<PromptRunResult> & Pick<PromptRunResult, "status">): PromptRunResult => ({
    stopReason: null,
    error: null,
    failure: null,
    usage: null,
    context,
    agentInfo,
    model,
    ...r,
  });

  try {
    if (opts.signal?.aborted) return result({ status: "cancelled", error: "cancelled before it started" });
    if (!existsSync(opts.cwd)) throw new Error(`working directory does not exist: ${opts.cwd}`);
    const spec = launchSpec(opts.harness, opts.cwd, opts.env);
    proc = await Promise.race([AcpProcess.start(spec, handlers, { initTimeoutMs: t.initMs }), abandoned]);
    const p = proc;
    emit({ type: "process.start", command: spec.command, args: spec.args, pid: p.pid });
    emit({ type: "initialize", response: p.init });
    agentInfo = p.init.agentInfo ?? null;
    const timed = <T>(q: Promise<T>, what: string) =>
      raceExit(
        Promise.race([withTimeout(q, t.sessionMs, `${what} timed out after ${t.sessionMs} ms`), abandoned]),
        p.exited,
        () => p.stderrTail(10),
      );

    const capabilities = p.init.agentCapabilities ?? {};
    const ctx = {
      cwd: opts.cwd,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      capabilities,
      mcp: opts.mcp,
      builtInTools: opts.builtInTools ?? null,
      isolated: opts.isolated ?? false,
    };
    const request: acp.NewSessionRequest = {
      cwd: opts.cwd,
      mcpServers: opts.mcp.servers,
      ...opts.adapter.sessionFields(ctx),
    };
    const session = await timed(p.agent.request("session/new", request), "session/new");
    sessionId = session.sessionId;
    emit({ type: "session.new", request, response: session });

    let configOptions = session.configOptions ?? [];
    const modelOpt = () =>
      configOptions.find((o) => o.category === "model") ?? configOptions.find((o) => o.id === "model");
    if (opts.adapter.modelViaConfigOption && opts.model) {
      const opt = modelOpt();
      if (opt && opt.type !== "boolean" && opt.currentValue !== opts.model && offers(opt, opts.model)) {
        try {
          const r = await timed(
            p.agent.request("session/set_config_option", { sessionId, configId: opt.id, value: opts.model }),
            "session/set_config_option",
          );
          configOptions = r.configOptions;
          emit({ type: "config", configId: opt.id, value: opts.model, error: null });
        } catch (e) {
          if (e instanceof Abandoned || e instanceof ExitError) throw e;
          emit({ type: "config", configId: opt.id, value: opts.model, error: describeError(e) });
        }
      } else if (!opt || opt.currentValue !== opts.model) {
        emit({
          type: "config",
          configId: opt?.id ?? "model",
          value: opts.model,
          error: "not offered by the harness",
        });
      }
    }
    const reported = modelOpt();
    if (reported && reported.type !== "boolean" && opts.adapter.modelViaConfigOption)
      model = reported.currentValue;

    const blocks: acp.ContentBlock[] = [];
    if (opts.adapter.needsPromptPreamble(ctx)) {
      blocks.push({
        type: "text",
        text: `<system-instructions>\n${opts.systemPrompt}\n</system-instructions>`,
      });
    }
    blocks.push(...(await opts.prompt(capabilities)));
    emit({ type: "prompt", prompt: blocks });

    lastActivity = Date.now();
    const tick = Math.max(20, Math.min(1000, Math.floor(Math.min(t.idleMs, t.toolIdleMs) / 4)));
    const idleCheck = () => {
      if (cancelReason) return;
      const limit = openTools.size ? t.toolIdleMs : t.idleMs;
      if (Date.now() - lastActivity >= limit) cancel("idle");
      else timers.push(setTimeout(idleCheck, tick));
    };
    timers.push(setTimeout(idleCheck, tick));
    timers.push(setTimeout(() => cancel("turn_limit"), t.turnMs));

    const response = await raceExit(
      Promise.race([p.agent.request("session/prompt", { sessionId, prompt: blocks }), abandoned]),
      p.exited,
      () => p.stderrTail(10),
    );
    emit({ type: "prompt.end", response });
    const usage = response.usage ?? null;
    if (cancelReason === "aborted")
      return result({ status: "cancelled", stopReason: response.stopReason, usage });
    if (cancelReason) {
      return result({
        status: "error",
        stopReason: response.stopReason,
        usage,
        failure: "timeout",
        error: timeoutMessage(cancelReason, openTools.size > 0, t),
      });
    }
    return result({ status: "complete", stopReason: response.stopReason, usage });
  } catch (e) {
    if (cancelReason === "aborted") return result({ status: "cancelled", error: "cancelled" });
    if (cancelReason) {
      return result({
        status: "error",
        failure: "timeout",
        error: timeoutMessage(cancelReason, openTools.size > 0, t),
      });
    }
    return result({ status: "error", failure: failureOf(e), error: describeError(e) });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    if (proc) {
      const p = proc;
      await p.close(1000);
      const info = await p.exited;
      emit({ type: "process.exit", code: info.code, signal: info.signal, stderr: p.stderrTail(20) });
    }
  }
}

function timeoutMessage(reason: CancelReason, toolOpen: boolean, t: RunTimeouts): string {
  if (reason === "turn_limit") return `the turn took longer than ${human(t.turnMs)}, so it was cancelled`;
  return `no response from the harness for ${human(toolOpen ? t.toolIdleMs : t.idleMs)}${toolOpen ? " while a tool ran" : ""}, so the turn was cancelled`;
}

const human = (ms: number) =>
  ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;

/** Claude Code puts its own tool name in `_meta.claudeCode.toolName`. */
function metaToolName(meta: unknown): string | null {
  const name = (meta as { claudeCode?: { toolName?: unknown } } | null | undefined)?.claudeCode?.toolName;
  return typeof name === "string" ? name : null;
}

/** The option of the wanted kind: once before always; null if the request offers none. */
export function pickOption(options: acp.PermissionOption[], decision: "allow" | "reject"): string | null {
  const kinds: acp.PermissionOptionKind[] =
    decision === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of kinds) {
    const o = options.find((x) => x.kind === kind);
    if (o) return o.optionId;
  }
  return null;
}

function offers(opt: acp.SessionConfigOption, value: string): boolean {
  if (opt.type === "boolean") return false;
  return opt.options.some((entry) =>
    "group" in entry ? entry.options.some((c) => c.value === value) : entry.value === value,
  );
}

function failureOf(e: unknown): RunFailure {
  if (e instanceof SpawnError) return e.notInstalled ? "not_installed" : "error";
  if (e instanceof ExitError) return "crash";
  if (e instanceof acp.RequestError && e.code === -32000) return "auth";
  return "error";
}

export function describeError(e: unknown): string {
  if (e instanceof acp.RequestError) {
    const data = e.data as { details?: unknown } | undefined;
    const details = typeof data?.details === "string" ? `: ${data.details}` : "";
    if (e.code === -32000) return `authentication required${details || `: ${e.message}`}`;
    return `${e.message}${details}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
