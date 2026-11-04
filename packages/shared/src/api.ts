import { z } from "zod";

/**
 * HTTP contract between server and web. Request bodies get a zod schema here (the server parses
 * every body with it); responses are plain types the server returns and the web app reads.
 */

export const apiPaths = {
  health: "/api/health",
  me: "/api/me",
} as const;

/** `GET /api/health`: answers without auth, so a probe can tell "up" from "not allowed". */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string(),
  /** Applied database migrations; a cheap proof the DB is open. */
  migrations: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `GET /api/me`: the Tailscale login the request was accepted for (`local` with auth off). */
export interface MeResponse {
  login: string;
}

/** Every non-2xx JSON response. `hint` points at what fixes it (e.g. a config key). */
export interface ApiError {
  error: string;
  hint?: string;
}
