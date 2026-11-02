import { WeightBody, type WeightEntryResponse, WeightQuery, type WeightResponse } from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** Weight entries (mounted under /api, behind auth). Paths: `weightPaths`. */
export function weightRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.post("/weight", async (c) => {
    const body = WeightBody.parse(await readJson(c));
    const entry = s.repos.weight.insert({ ...body, measuredAt: body.measuredAt ?? Date.now() });
    return c.json<WeightEntryResponse>({ entry }, 201);
  });

  r.get("/weight", (c) =>
    c.json<WeightResponse>({ entries: s.repos.weight.list(WeightQuery.parse(c.req.query())) }),
  );

  r.delete("/weight/:id", (c) => {
    if (!s.repos.weight.delete(c.req.param("id"))) throw new HttpError(404, "weight entry not found");
    return c.body(null, 204);
  });

  return r;
}
