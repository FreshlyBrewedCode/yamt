import type { McpSetup } from "../mcp.ts";
import type * as acp from "../protocol.ts";

export type HarnessKind = "claude-code" | "custom";

/** Everything an adapter needs to shape one session. */
export interface SessionFieldsContext {
  cwd: string;
  /** Appended to the harness's own system prompt (the job's skill). */
  systemPrompt: string;
  model: string | null;
  capabilities: acp.AgentCapabilities;
  mcp: McpSetup;
  /**
   * The harness's built-in tools to offer (Claude Code `tools`), null for its default set.
   * Harnesses without such a knob ignore it; the permission policy still applies.
   */
  builtInTools: string[] | null;
  /**
   * Don't load the user's own harness settings (Claude Code `settingSources: []`: no
   * ~/.claude settings, hooks, plugins or CLAUDE.md), so a background job runs the same way
   * whatever the interactive setup is. Login credentials are unaffected.
   */
  isolated: boolean;
}

/** Extra fields merged into session/new. */
export interface SessionFields {
  /** Replaces the MCP servers from the McpSetup (e.g. with secrets moved out of the config). */
  mcpServers?: acp.McpServer[];
  systemPrompt?: acp.SystemPrompt;
  _meta?: Record<string, unknown>;
}

/**
 * Hides one harness's quirks behind a common shape. Everything that is plain ACP (session,
 * prompt, cancel, permissions) is handled by `runPrompt`; adapters only map the system prompt,
 * model and app tools onto what the harness understands.
 */
export interface HarnessAdapter {
  readonly kind: HarnessKind;
  /** Command line used when the harness config leaves `command` empty. */
  defaultLaunch(): { command: string; args: string[] } | null;
  /** Harness-specific session fields: system prompt, model, tool permissions. */
  sessionFields(ctx: SessionFieldsContext): SessionFields;
  /** True if the model is chosen with `session/set_config_option` after session/new. */
  readonly modelViaConfigOption: boolean;
  /**
   * True if the harness can't take a system prompt at session setup, so it goes as a preamble
   * block before the prompt.
   */
  needsPromptPreamble(ctx: SessionFieldsContext): boolean;
}

/** The spec's `systemPrompt` field, when the agent advertises `sessionCapabilities.systemPrompt`. */
export function specSystemPrompt(ctx: SessionFieldsContext): acp.SystemPrompt | undefined {
  if (!ctx.systemPrompt.trim() || !ctx.capabilities.sessionCapabilities?.systemPrompt) return undefined;
  return { mode: "append", content: [{ type: "text", text: ctx.systemPrompt }] };
}
