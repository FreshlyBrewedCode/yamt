import type { LaunchSpec } from "../process.ts";
import { claudeCodeAdapter } from "./claude-code.ts";
import { customAdapter } from "./custom.ts";
import type { HarnessAdapter, HarnessKind } from "./types.ts";

export type { HarnessAdapter, HarnessKind, SessionFields, SessionFieldsContext } from "./types.ts";

export const adapters: Record<HarnessKind, HarnessAdapter> = {
  "claude-code": claudeCodeAdapter,
  custom: customAdapter,
};

/** Harness config as configured (an empty command means the preset's default). */
export interface HarnessConfig {
  kind: HarnessKind;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The command line a harness config runs, or null if it has none (custom without command). */
export function resolveCommand(h: HarnessConfig): { command: string; args: string[] } | null {
  if (h.command.trim()) return { command: h.command.trim(), args: h.args };
  const def = adapters[h.kind].defaultLaunch();
  return def ? { command: def.command, args: [...def.args, ...h.args] } : null;
}

export function launchSpec(h: HarnessConfig, cwd: string, extraEnv: Record<string, string> = {}): LaunchSpec {
  const cmd = resolveCommand(h);
  if (!cmd) throw new Error(`the ${h.kind} harness has no command configured`);
  return { command: cmd.command, args: cmd.args, env: { ...h.env, ...extraEnv }, cwd };
}
