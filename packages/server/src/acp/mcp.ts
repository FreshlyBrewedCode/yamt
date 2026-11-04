import type * as acp from "./protocol.ts";

/** What a session gets from the app's MCP side. */
export interface McpSetup {
  /** Passed as `mcpServers` in session/new. */
  servers: acp.McpServer[];
  /**
   * Tool patterns the harness may call without a permission round trip (Claude Code
   * `allowedTools`, e.g. `mcp__yamt`). Harnesses without such a knob ignore it.
   */
  allowedTools: string[];
  /**
   * The per-run bearer token in `servers` (the `Authorization` header of the HTTP server named
   * `server`). Adapters that can reference env vars in MCP config move it out of the config,
   * which some harnesses put on a command line (see the Claude Code adapter).
   */
  credential?: { server: string; token: string };
}

/** An HTTP MCP server with a bearer token, as ACP's `session/new` takes it. */
export function httpMcpServer(name: string, url: string, token: string): acp.McpServer {
  return { type: "http", name, url, headers: [{ name: "Authorization", value: `Bearer ${token}` }] };
}
