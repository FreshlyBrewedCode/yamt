import { dirname, join } from "node:path";
import type * as acp from "../protocol.ts";
import type { HarnessAdapter, SessionFieldsContext } from "./types.ts";
import { specSystemPrompt } from "./types.ts";

/** Env var that carries the MCP token into `claude` (referenced from the MCP config). */
export const CLAUDE_TOKEN_ENV = "YAMT_MCP_TOKEN";

function adapterEntry(): string {
  // Resolves to dist/lib.js; the CLI entry (its `bin`) sits next to it.
  return join(dirname(Bun.resolveSync("@agentclientprotocol/claude-agent-acp", import.meta.dir)), "index.js");
}

/**
 * Claude Code through @agentclientprotocol/claude-agent-acp, run with node (its shebang), or with
 * Bun when there is no node. Ported from vibe-center (see its spikes/acp-latency/FINDINGS.md):
 * - the skill appended to the Claude Code preset (spec `systemPrompt`, else `_meta.systemPrompt`)
 * - model and Claude Agent SDK options through `_meta.claudeCode.options`
 * - ENABLE_TOOL_SEARCH=false: otherwise the first use of each MCP tool costs an extra model call
 * - the yamt tools pre-allowed (`allowedTools`), so they don't trigger a permission round trip
 * - prompt suggestions off (they cost tokens after every turn)
 * - the MCP token kept off the command line: claude-agent-acp passes MCP servers to the `claude`
 *   binary as `--mcp-config <json>` on its argv, which any local user can read in
 *   /proc/<pid>/cmdline. The header says `Bearer ${YAMT_MCP_TOKEN}` instead (Claude Code expands
 *   env vars in MCP config) and the token goes in that session's env.
 * - for jobs: only the built-in tools the job needs (`tools`), and none of the user's own
 *   settings, hooks, plugins or CLAUDE.md (`settingSources: []`).
 * Auth uses the `claude` CLI login (~/.claude).
 */
export const claudeCodeAdapter: HarnessAdapter = {
  kind: "claude-code",
  modelViaConfigOption: false,

  defaultLaunch: () => ({ command: Bun.which("node") ?? process.execPath, args: [adapterEntry()] }),

  sessionFields(ctx: SessionFieldsContext) {
    const systemPrompt = specSystemPrompt(ctx);
    const env: Record<string, string> = { ENABLE_TOOL_SEARCH: "false" };
    const options: Record<string, unknown> = { env, promptSuggestions: false };
    let mcpServers: acp.McpServer[] | undefined;
    const cred = ctx.mcp.credential;
    if (cred) {
      env[CLAUDE_TOKEN_ENV] = cred.token;
      mcpServers = ctx.mcp.servers.map((s) =>
        "type" in s && s.type === "http" && s.name === cred.server
          ? {
              ...s,
              headers: s.headers.map((h) =>
                h.name.toLowerCase() === "authorization"
                  ? { ...h, value: `Bearer \${${CLAUDE_TOKEN_ENV}}` }
                  : h,
              ),
            }
          : s,
      );
    }
    if (ctx.model) options.model = ctx.model;
    if (ctx.mcp.allowedTools.length) options.allowedTools = ctx.mcp.allowedTools;
    if (ctx.builtInTools) options.tools = ctx.builtInTools;
    if (ctx.isolated) options.settingSources = [];
    const meta: Record<string, unknown> = { claudeCode: { options } };
    if (!systemPrompt && ctx.systemPrompt.trim()) meta.systemPrompt = { append: ctx.systemPrompt };
    return { ...(mcpServers ? { mcpServers } : {}), ...(systemPrompt ? { systemPrompt } : {}), _meta: meta };
  },

  needsPromptPreamble: () => false,
};
