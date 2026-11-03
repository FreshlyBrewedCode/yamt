import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type BearerEnv, requireBearer } from "../auth/bearer.ts";
import { IDENTITY_HEADER } from "../auth/identity.ts";
import { VERSION } from "../config.ts";
import { HttpError } from "../domain/errors.ts";
import { handleError } from "../http/middleware.ts";
import type { Services } from "../services.ts";
import type { McpPrincipal } from "./tokens.ts";
import { allowed, callTool, MCP_INSTRUCTIONS, type Tool, yamtTools } from "./tools.ts";

/** Claude Code shows the tools as `mcp__yamt__<tool>`. */
export const MCP_SERVER_NAME = "yamt";
export const MCP_PATH = "/mcp";

/**
 * MCP and agents run on this machine and call 127.0.0.1 directly. Anything that came through
 * `tailscale serve` (forwarding / identity headers) or from a browser (`Origin`, which the MCP
 * spec asks servers to check against DNS rebinding) is refused, whatever token it carries.
 */
const localOnly: MiddlewareHandler = async (c, next) => {
  const h = c.req.raw.headers;
  if (h.has("origin") || h.has("x-forwarded-for") || h.has("x-forwarded-host") || h.has(IDENTITY_HEADER)) {
    throw new HttpError(403, "the MCP endpoint is only reachable from this machine");
  }
  await next();
};

/**
 * The yamt MCP server at `/mcp`: streamable HTTP in its stateless form. Every POST carries one
 * JSON-RPC message (or batch) and gets one JSON answer; no sessions, no server-sent stream (GET
 * and DELETE answer 405). A fresh SDK server is built per request for the caller's token, so a
 * run token only ever sees the tools it may use.
 */
export function createMcpApp(s: Services): Hono<BearerEnv<McpPrincipal>> {
  const tools = yamtTools(s);
  const app = new Hono<BearerEnv<McpPrincipal>>();
  app.onError(handleError);
  app.use("*", localOnly, requireBearer(s.mcpTokens.verify));

  app.post("/", async (c) => {
    const server = buildServer(tools, c.get("principal"));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close().catch(() => {});
    }
  });

  app.all("/", (c) => {
    c.header("Allow", "POST");
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "method not allowed: this server is stateless, POST only" },
        id: null,
      },
      405,
    );
  });
  app.all("*", () => {
    throw new HttpError(404, "not found");
  });
  return app;
}

function buildServer(tools: readonly Tool[], principal: McpPrincipal): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: VERSION },
    { capabilities: { tools: { listChanged: false } }, instructions: MCP_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools
      .filter((t) => allowed(t, principal))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchema(t) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    callTool(tools, req.params.name, req.params.arguments ?? {}, { principal }),
  );
  return server;
}

const schemas = new WeakMap<Tool, { type: "object"; [k: string]: unknown }>();
function inputSchema(t: Tool) {
  let schema = schemas.get(t);
  if (!schema) {
    const { $schema: _, ...rest } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    schema = { ...rest, type: "object" };
    schemas.set(t, schema);
  }
  return schema;
}
