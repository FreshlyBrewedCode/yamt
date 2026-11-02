import type { ApiError } from "@yamt/shared";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { HttpError } from "../domain/errors.ts";
import { originAllowed } from "./origin.ts";

/**
 * CSRF guard for state-changing requests. `tailscale serve` attaches the user's identity to every
 * request from their devices, including ones a foreign page triggers, so a write must also come
 * from our own origin.
 */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !originAllowed(c.req.raw)) {
    throw new HttpError(403, "cross-origin request refused");
  }
  await next();
};

/** HttpError / ZodError → `{ error, hint? }` JSON; anything else is a logged 500. */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json<ApiError>({ error: err.message, ...(err.hint ? { hint: err.hint } : {}) }, err.status);
  }
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return c.json<ApiError>({ error: `${where}${issue?.message ?? "invalid request"}` }, 400);
  }
  console.error("API error", err);
  return c.json<ApiError>({ error: "internal error" }, 500);
}

/** The request's JSON body (an empty body counts as `{}`); malformed JSON is a 400, not a 500. */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "the body is not valid JSON");
  }
}
