import { join } from "node:path";
import type { PlanningRunResponse, RunResponse } from "@yamt/shared";
import { Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { dataPaths } from "../config.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";

/**
 * Analysis and planning runs and their traces (mounted under /api, behind auth). Paths:
 * `runPaths`. Both kinds keep their trace in `<data>/runs/<run id>/`.
 */
export function runRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  const run = (id: string) => {
    const found = s.repos.runs.get(id);
    if (!found) throw new HttpError(404, "run not found");
    return found;
  };

  const planningRun = (id: string) => {
    const found = s.repos.planningRuns.get(id);
    if (!found) throw new HttpError(404, "planning run not found");
    return found;
  };

  r.get("/runs/:id", (c) => c.json<RunResponse>({ run: run(c.req.param("id")) }));
  r.get("/planning/runs/:id", (c) => c.json<PlanningRunResponse>({ run: planningRun(c.req.param("id")) }));

  // NDJSON as written; a running run's trace grows, so it is never cached.
  r.get("/runs/:id/trace", async (c) => {
    const param = c.req.param("id");
    const found = s.repos.runs.get(param) ?? s.repos.planningRuns.get(param);
    if (!found) throw new HttpError(404, "run not found");
    const { id } = found;
    const file = Bun.file(join(dataPaths(s.dataDir).runs, id, "trace.ndjson"));
    if (!(await file.exists())) throw new HttpError(404, "this run has no trace");
    return new Response(file.stream(), {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return r;
}
