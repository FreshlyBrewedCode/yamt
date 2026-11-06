import {
  CreateLeftoverBody,
  type LeftoverResponse,
  type LeftoversResponse,
  PlanLeftoverBody,
  type PlannedMealResponse,
  UpdateLeftoverBody,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** The leftovers list (#49; mounted under /api, behind auth). Paths: `leftoverPaths`. */
export function leftoverRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/leftovers", (c) => c.json<LeftoversResponse>({ leftovers: s.leftovers.list() }));

  r.post("/leftovers", async (c) => {
    const { leftover, created } = s.leftovers.create(CreateLeftoverBody.parse(await readJson(c)));
    return c.json<LeftoverResponse>({ leftover }, created ? 201 : 200);
  });

  r.patch("/leftovers/:id", async (c) => {
    const { status } = UpdateLeftoverBody.parse(await readJson(c));
    return c.json<LeftoverResponse>({ leftover: s.leftovers.setStatus(c.req.param("id"), status) });
  });

  // "Plan it": a cooked leftover onto a slot, a planned meal that cooks nothing
  r.post("/leftovers/:id/plan", async (c) => {
    const { plannedMeal, created } = s.planning.planLeftover(
      c.req.param("id"),
      PlanLeftoverBody.parse(await readJson(c)),
    );
    return c.json<PlannedMealResponse>({ plannedMeal }, created ? 201 : 200);
  });

  return r;
}
