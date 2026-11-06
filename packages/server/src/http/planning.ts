import {
  CreatePlannedMealBody,
  LogPlannedMealBody,
  type LogPlannedMealResponse,
  type PlannedMealResponse,
  PlanQuery,
  type PlanResponse,
  type RecipeView,
  UpdatePlannedMealBody,
} from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import type { Services } from "../services.ts";
import { readJson } from "./middleware.ts";

/** The plan, recipes and planned meals (#36; mounted under /api, behind auth). Paths: `planningPaths`. */
export function planningRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.get("/plan", (c) => c.json<PlanResponse>(s.planning.plan(PlanQuery.parse(c.req.query()))));

  r.get("/recipes/:id", (c) => c.json<RecipeView>(s.recipes.get(c.req.param("id"))));

  r.post("/planned-meals", async (c) => {
    const { plannedMeal, created } = s.planning.create(CreatePlannedMealBody.parse(await readJson(c)));
    return c.json<PlannedMealResponse>({ plannedMeal }, created ? 201 : 200);
  });

  r.patch("/planned-meals/:id", async (c) =>
    c.json<PlannedMealResponse>({
      plannedMeal: s.planning.update(c.req.param("id"), UpdatePlannedMealBody.parse(await readJson(c))),
    }),
  );

  // unplan: only a planned one (logged and skipped ones are history)
  r.delete("/planned-meals/:id", (c) => {
    s.planning.unplan(c.req.param("id"));
    return c.body(null, 204);
  });

  r.post("/planned-meals/:id/skip", (c) =>
    c.json<PlannedMealResponse>({ plannedMeal: s.planning.skip(c.req.param("id")) }),
  );
  r.post("/planned-meals/:id/unskip", (c) =>
    c.json<PlannedMealResponse>({ plannedMeal: s.planning.unskip(c.req.param("id")) }),
  );

  // "Ate it": a new meal from the recipe, no analysis
  r.post("/planned-meals/:id/log", async (c) => {
    const { created, ...res } = s.planning.log(
      c.req.param("id"),
      LogPlannedMealBody.parse(await readJson(c)),
    );
    return c.json<LogPlannedMealResponse>(res, created ? 201 : 200);
  });

  return r;
}
