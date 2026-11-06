import { execFileSync } from "node:child_process";

/**
 * Calls a yamt MCP tool with the interactive token of the data dir, as a Claude Code session would
 * (recipes and plans have no HTTP writes of their own yet: the planning screens come later, #36).
 * `/mcp` only answers this machine and refuses an Origin, so this is a plain fetch, not the
 * browser's request context.
 */
export async function callTool<T = Record<string, unknown>>(
  baseUrl: string,
  dataDir: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = execFileSync("bun", ["packages/server/src/cli.ts", "mcp-token", "--data-dir", dataDir], {
    encoding: "utf8",
  }).trim();
  const res = await fetch(new URL("/mcp", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as {
    result?: { isError?: boolean; content: { type: string; text: string }[] };
    error?: { message: string };
  };
  const text = body.result?.content[0]?.text ?? "";
  if (!res.ok || body.error || body.result?.isError) {
    throw new Error(`${name}: ${body.error?.message ?? text ?? res.status}`);
  }
  return JSON.parse(text) as T;
}
