import { resolve, sep } from "node:path";
import type * as acp from "../acp/protocol.ts";
import type { PermissionPolicy } from "../acp/run.ts";

/** The yamt MCP tools as Claude Code names them. */
export const YAMT_TOOL_PREFIX = "mcp__yamt__";
/** Built-in tools an analysis may use without asking: reading recipe pages and searching. */
export const WEB_TOOLS = ["WebFetch", "WebSearch"];

/**
 * What an analysis run may do, decided without a human: the yamt tools and web fetch/search are
 * allowed; reading a file only where `readable` says so (the meal's photos, the run dir);
 * everything else (shell, edits and writes, other files) is rejected. A request without a
 * fitting option is answered `cancelled` by the runtime, never left pending.
 */
export function analysisPermissions(readable: (absPath: string) => boolean): PermissionPolicy {
  return (req, toolName) => {
    const kind = req.toolCall.kind ?? null;
    if (toolName?.startsWith(YAMT_TOOL_PREFIX)) return "allow";
    if (toolName !== null && WEB_TOOLS.includes(toolName)) return "allow";
    if (toolName === null && kind === "fetch") return "allow";
    if (toolName === "Read" || (toolName === null && kind === "read")) {
      const path = requestedPath(req.toolCall);
      return path !== null && readable(resolve(path)) ? "allow" : "reject";
    }
    return "reject";
  };
}

/** The file a read asks for: `rawInput.file_path` / `path`, else the first location. */
function requestedPath(call: acp.ToolCallUpdate): string | null {
  const input = call.rawInput as { file_path?: unknown; path?: unknown } | null | undefined;
  const p = input?.file_path ?? input?.path ?? call.locations?.[0]?.path;
  return typeof p === "string" && p.startsWith("/") ? p : null;
}

export const isInside = (path: string, dir: string): boolean => {
  const d = resolve(dir);
  return path === d || path.startsWith(d + sep);
};
