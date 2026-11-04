import { existsSync } from "node:fs";
import { type HarnessAdapter, type HarnessConfig, launchSpec } from "./adapters/index.ts";
import type { AuthReport } from "./adapters/types.ts";
import { configStep } from "./config-options.ts";
import { AcpProcess, raceExit, SpawnError, withTimeout } from "./process.ts";
import * as acp from "./protocol.ts";
import { describeError, type RunFailure } from "./run.ts";

export interface DiscoverOptions {
  harness: HarnessConfig;
  adapter: HarnessAdapter;
  /** A scratch working directory (exists); harnesses keep per-directory state, so reuse one. */
  cwd: string;
  /** Select this model first, so the options are the ones it has (efforts depend on the model). */
  model: string | null;
  timeoutMs?: number;
}

export type DiscoverResult =
  | {
      ok: true;
      agentInfo: acp.Implementation | null;
      /** The options after selecting `model` (when the harness offers it). */
      configOptions: acp.SessionConfigOption[];
      /** The calls made, in order (for tests and the log). */
      configCalls: { configId: string; value: string }[];
    }
  | { ok: false; failure: Exclude<RunFailure, "timeout" | "crash">; error: string };

/**
 * Asks a harness what it offers, without a prompt (costs no model tokens): spawn, `initialize`,
 * `session/new` in `cwd` without MCP servers, select `model` if asked and offered, read the
 * config options, stop the process group. Never throws.
 */
export async function discoverOptions(opts: DiscoverOptions): Promise<DiscoverResult> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  let proc: AcpProcess | null = null;
  let auth: AuthReport | null = null;
  try {
    if (!existsSync(opts.cwd)) throw new Error(`working directory does not exist: ${opts.cwd}`);
    const prepared = (await opts.adapter.prepareProcess?.({ cwd: opts.cwd, systemPrompt: "" })) ?? {};
    proc = await AcpProcess.start(
      launchSpec(opts.harness, opts.cwd, prepared),
      {
        onUpdate: () => {},
        onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        onOtherNotification: (method, params) => {
          auth = opts.adapter.readAuth?.(method, params) ?? auth;
        },
      },
      { initTimeoutMs: timeoutMs },
    );
    const p = proc;
    const timed = <T>(q: Promise<T>, what: string) =>
      raceExit(withTimeout(q, timeoutMs, `${what} timed out after ${timeoutMs} ms`), p.exited, () =>
        p.stderrTail(10),
      );
    const ctx = {
      cwd: opts.cwd,
      systemPrompt: "",
      model: opts.model,
      capabilities: p.init.agentCapabilities ?? {},
      mcp: { servers: [], allowedTools: [] },
      builtInTools: null,
      isolated: true,
    };
    const session = await timed(
      p.agent.request("session/new", { cwd: opts.cwd, mcpServers: [], ...opts.adapter.sessionFields(ctx) }),
      "session/new",
    );
    let configOptions = session.configOptions ?? [];
    const configCalls: { configId: string; value: string }[] = [];
    const step = opts.model ? configStep(configOptions, "model", opts.model) : null;
    if (step?.kind === "set") {
      const r = await timed(
        p.agent.request("session/set_config_option", {
          sessionId: session.sessionId,
          configId: step.configId,
          value: step.value,
        }),
        "session/set_config_option",
      );
      configOptions = r.configOptions;
      configCalls.push({ configId: step.configId, value: step.value });
    }
    // claude-agent-acp reports its login right after session/new
    if (opts.adapter.readAuth && !auth) await waitFor(() => auth !== null, 1500);
    const report = auth as AuthReport | null;
    if (report && !report.loggedIn) {
      return { ok: false, failure: "auth", error: `not logged in (${report.label})` };
    }
    return { ok: true, agentInfo: p.init.agentInfo ?? null, configOptions, configCalls };
  } catch (e) {
    if (e instanceof SpawnError)
      return { ok: false, failure: e.notInstalled ? "not_installed" : "error", error: e.message };
    if (e instanceof acp.RequestError && e.code === -32000)
      return { ok: false, failure: "auth", error: describeError(e) };
    return { ok: false, failure: "error", error: describeError(e) };
  } finally {
    await proc?.close(1000);
  }
}

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await Bun.sleep(25);
}
