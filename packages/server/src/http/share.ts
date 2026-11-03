import { type ApiError, ShareFields, type ShareResponse, sharePaths } from "@yamt/shared";
import { type Context, Hono } from "hono";
import type { IdentityEnv } from "../auth/identity.ts";
import { HttpError } from "../domain/errors.ts";
import type { Services } from "../services.ts";
import { handleError } from "./middleware.ts";
import { publicOrigin } from "./origin.ts";

/**
 * `POST /api/share` (#26): the iOS Shortcut's upload from another app's share sheet. Behind the
 * tailnet identity like every route; `sameOrigin` lets this one path through without an Origin
 * header (see there). JSON for clients that ask for it, else the summary as plain text, which is
 * what the Shortcut's notification shows (errors too).
 */
export function shareRoutes(s: Services): Hono<IdentityEnv> {
  const r = new Hono<IdentityEnv>();

  r.post(sharePaths.share.slice("/api".length), async (c) => {
    const json = wantsJson(c);
    try {
      const type = c.req.header("content-type")?.toLowerCase() ?? "";
      if (!type.startsWith("multipart/form-data")) {
        throw new HttpError(415, "send multipart/form-data with file, text or url fields");
      }
      const form = await c.req.raw.formData().catch(() => {
        throw new HttpError(400, "malformed multipart body");
      });
      const strings = (name: string) =>
        form.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "");
      const fields = ShareFields.parse({ capturedAt: strings("capturedAt")[0] });
      // a Shortcut may put shared text into the file field: it is read like a text field
      const files: (File | string)[] = [];
      for (const v of form.getAll("file")) {
        if (v instanceof File) files.push(v);
        else if (typeof v === "string" && v.trim() !== "") files.push(v);
      }
      const res = await s.share.share({
        files,
        texts: strings("text"),
        urls: strings("url"),
        capturedAt: fields.capturedAt,
      });
      const body: ShareResponse = { ...res, url: `${publicOrigin(c.req.raw)}/meals/${res.meal.id}` };
      const status = res.newMeal ? 201 : 200;
      return json ? c.json<ShareResponse>(body, status) : c.text(body.summary, status);
    } catch (e) {
      if (json) throw e;
      // the Shortcut shows whatever comes back: make a refusal readable there
      const res = handleError(e as Error, c);
      const { error, hint } = (await res.json()) as ApiError;
      return c.text(`Not added: ${error}${hint ? ` (${hint})` : ""}`, res.status as 400);
    }
  });

  return r;
}

const wantsJson = (c: Context) => (c.req.header("accept") ?? "").toLowerCase().includes("application/json");
