import { apiPaths, type HealthResponse, type MeResponse } from "@yamt/shared";
import { Hono } from "hono";
import { type AuthMode, type IdentityEnv, requireTailnetIdentity } from "../auth/identity.ts";
import { VERSION } from "../config.ts";
import { appliedMigrations, type Db } from "../db/index.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { goalRoutes } from "./goals.ts";
import { mealRoutes } from "./meals.ts";
import { handleError, sameOrigin } from "./middleware.ts";
import { pushRoutes } from "./push.ts";
import { runRoutes } from "./runs.ts";
import { weightRoutes } from "./weight.ts";

export interface ApiDeps {
  db: Db;
  auth: AuthMode;
  services: Services;
}

/**
 * The browser-facing JSON API, mounted at /api. Health is public; every other route (including
 * unknown ones) needs the tailnet identity, and writes a same-origin request.
 */
export function createApi(deps: ApiDeps): Hono<IdentityEnv> {
  const api = new Hono<IdentityEnv>();
  api.onError(handleError);

  api.get(apiPaths.health.slice("/api".length), (c) =>
    c.json<HealthResponse>({ status: "ok", version: VERSION, migrations: appliedMigrations(deps.db) }),
  );

  api.use("*", sameOrigin, requireTailnetIdentity(deps.auth));

  api.get(apiPaths.me.slice("/api".length), (c) => c.json<MeResponse>({ login: c.get("login") }));
  api.route("/", mealRoutes(deps.services));
  api.route("/", runRoutes(deps.services));
  api.route("/", weightRoutes(deps.services));
  api.route("/", goalRoutes(deps.services));
  api.route("/", pushRoutes(deps.services));

  api.all("*", () => {
    throw new HttpError(404, "not found");
  });
  return api;
}
