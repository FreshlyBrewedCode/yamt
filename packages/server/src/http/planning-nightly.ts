import { type NightlyResponse, RegenerateNightlyBody, type RegenerateNightlyResponse } from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** The nightly run (#48), mounted under /api behind auth. Paths: `planningNightlyPaths`. */
export function planningNightlyRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/planning/nightly", (c) => c.json<NightlyResponse>(s.nightly.view()));

  r.post("/planning/nightly/regenerate", async (c) => {
    const body = RegenerateNightlyBody.parse(await readJson(c));
    const existed = body.id ? s.repos.planningRequests.get(body.id) !== null : false;
    return c.json<RegenerateNightlyResponse>(s.nightly.regenerate(body), existed ? 200 : 201);
  });

  return r;
}
