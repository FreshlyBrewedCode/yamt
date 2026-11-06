import { type ApiError, sharePaths } from "@yamt/shared";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { HttpError } from "../domain/errors.ts";
import { originAllowed } from "./origin.ts";

/**
 * Writes that may come without an Origin header: `POST /api/share` only, the iOS Shortcut's
 * upload (#26). Shortcuts is not a browser and sends no Origin, but the request comes from the
 * user's iPhone through `tailscale serve`, so it carries the identity like any other. That is
 * safe because the attack this guard stops is a foreign *web page* making the user's browser
 * post to yamt, and browsers always send Origin on cross-site POSTs (fetch, XHR and form
 * submissions alike; `null` where they hide it): a present Origin that isn't ours is refused
 * here too. Every other write still needs our own Origin.
 */
const ORIGINLESS_WRITES = new Set([`POST ${sharePaths.share}`]);

/**
 * CSRF guard for state-changing requests. `tailscale serve` attaches the user's identity to every
 * request from their devices, including ones a foreign page triggers, so a write must also come
 * from our own origin (except the one path above, when it has no Origin at all).
 */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const originless =
      c.req.header("origin") === undefined && ORIGINLESS_WRITES.has(`${c.req.method} ${c.req.path}`);
    if (!originless && !originAllowed(c.req.raw)) throw new HttpError(403, "cross-origin request refused");
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

/** A multipart body (malformed is a 400) with its `file` part (required) and a reader for text fields. */
export async function readUpload(
  c: Context,
): Promise<{ file: File; field: (name: string) => string | undefined }> {
  const form = await c.req.raw.formData().catch(() => {
    throw new HttpError(400, "malformed multipart body");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file: a file upload is required");
  return {
    file,
    field: (name) => {
      const v = form.get(name);
      return typeof v === "string" && v !== "" ? v : undefined;
    },
  };
}
