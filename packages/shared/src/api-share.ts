import { z } from "zod";
import type { Capture, Meal } from "./api-meals.ts";

/**
 * Sharing from other apps (#26): an iOS Shortcut in the share sheet posts what it gets to
 * `POST /api/share`, which adds it to the current draft meal (or starts one). Pasting inside the
 * app uses the normal capture route through the upload queue instead.
 */

export const sharePaths = {
  /**
   * `multipart/form-data`: one or more `file` fields and/or `text` / `url` fields, optional
   * `capturedAt`. Answers `ShareResponse` as JSON when the request accepts `application/json`,
   * else the summary as plain text (what the Shortcut shows in its notification).
   */
  share: "/api/share",
} as const;

/**
 * Shared items go into the most recently updated draft meal if it was created or changed this
 * recently; otherwise they start a new draft.
 */
export const SHARE_DRAFT_WINDOW_MS = 3 * 60 * 60_000;

/** Epoch ms, or anything `Date.parse` reads (a Shortcut's date as ISO 8601). */
const shareTime = z
  .string()
  .trim()
  .min(1)
  .transform((s, ctx) => {
    const ms = /^\d+$/.test(s) ? Number(s) : Date.parse(s);
    if (!Number.isFinite(ms) || ms < 0) {
      ctx.addIssue({ code: "custom", message: "a time as epoch milliseconds or ISO 8601" });
      return z.NEVER;
    }
    return ms;
  });

/** The text fields of a share (the files are `file` parts). */
export const ShareFields = z.object({
  /** When the items were captured; else a photo's EXIF time, else arrival. */
  capturedAt: shareTime.optional(),
});
export type ShareFields = z.infer<typeof ShareFields>;

export interface ShareResponse {
  /** The meal the items went into, after they were added. */
  meal: Meal;
  /** True when no draft was recent enough and a new one was started. */
  newMeal: boolean;
  /** One per stored item, in the order they arrived. */
  captures: Capture[];
  /** "Added 1 voice memo to Untitled meal, 19:10". */
  summary: string;
  /** The meal in the app, on the origin the request came in on. */
  url: string;
}

/**
 * The URL when a pasted or shared text is nothing but one http(s) link (surrounding whitespace
 * aside), else null. Text with words around a link stays a note. (A pattern, not `URL`: this
 * package has no DOM or Node types; the server's zod schema still validates what is sent.)
 */
export function singleUrl(text: string): string | null {
  const s = text.trim();
  if (s.length > 4_000) return null;
  return /^https?:\/\/[^\s/?#@]*[a-z0-9][^\s/?#@]*(?:[/?#]\S*)?$/i.test(s) ? s : null;
}
