import { type AgentOptionsResponse, type AgentResponse, AgentSettingsBody, HarnessKind } from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** The Agent setting (#28), mounted under /api behind auth. Paths: `agentPaths`. */
export function agentRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/agent", (c) => c.json<AgentResponse>(s.agent.view()));

  // starts the harness (no prompt) unless cached: about a second for Claude Code, two for OpenCode
  r.get("/agent/options", async (c) => {
    const kind = HarnessKind.safeParse(c.req.query("harness"));
    if (!kind.success) throw new HttpError(400, "harness: expected claude-code, opencode or custom");
    const model = c.req.query("model")?.trim() || null;
    const refresh = c.req.query("refresh") === "1";
    return c.json<AgentOptionsResponse>(await s.agent.options(kind.data, model, refresh));
  });

  r.put("/agent", async (c) => {
    const body = AgentSettingsBody.parse(await readJson(c));
    return c.json<AgentResponse>(await s.agent.save(body));
  });

  r.put("/agent/planning", async (c) => {
    const body = AgentSettingsBody.parse(await readJson(c));
    return c.json<AgentResponse>(await s.agent.savePlanning(body));
  });

  return r;
}
