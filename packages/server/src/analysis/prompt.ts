import type { Transcript } from "@yamt/shared";
import type * as acp from "../acp/protocol.ts";
import type { CaptureRecord } from "../db/repos/captures.ts";
import { isoLocal } from "../domain/time.ts";
import { AGENT_IMAGE_EDGE, downscaleJpeg } from "../media/downscale.ts";
import type { MediaStore } from "../media/store.ts";

/** At most this many photos go along as image blocks; further ones are listed by path. */
export const MAX_ATTACHED_PHOTOS = 8;
/** Non-JPEG images (PNG screenshots …) are attached as they are up to this size. */
const MAX_RAW_IMAGE_BYTES = 4 * 1024 * 1024;

/** A photo as the agent gets it: a file it can open, and the bytes to attach if possible. */
export interface AgentPhoto {
  captureId: string;
  takenAt: number;
  /** Absolute path of the file to show (the downscaled copy when there is one). */
  path: string | null;
  mimeType: string | null;
  /** Why the photo can't be shown, e.g. a HEIC photo whose JPEG conversion failed. */
  problem: string | null;
}

/**
 * The photo as the model should see it: a JPEG at most 1600 px on the long side, upright. The
 * downscaled copy is cached next to the original as `<capture id>.1600.jpg` (written once,
 * like every media file; the original is never touched). HEIC photos use their JPEG derivative.
 */
export async function agentPhoto(c: CaptureRecord, media: MediaStore): Promise<AgentPhoto> {
  const takenAt = c.takenAt ?? c.capturedAt ?? c.createdAt;
  const base = { captureId: c.id, takenAt };
  const heif = c.mimeType === "image/heic" || c.mimeType === "image/heif";
  const jpegSource = c.jpegPath ?? (c.mimeType === "image/jpeg" ? c.mediaPath : null);
  if (!jpegSource) {
    if (heif || !c.mediaPath) {
      return {
        ...base,
        path: null,
        mimeType: null,
        problem: "a HEIC photo that could not be converted to JPEG",
      };
    }
    return { ...base, path: media.absolute(c.mediaPath), mimeType: c.mimeType, problem: null };
  }
  const cacheRel = jpegSource.replace(/\.[^./]+$/, `.${AGENT_IMAGE_EDGE}.jpg`);
  const cacheAbs = media.absolute(cacheRel);
  if (await Bun.file(cacheAbs).exists())
    return { ...base, path: cacheAbs, mimeType: "image/jpeg", problem: null };
  const sourceAbs = media.absolute(jpegSource);
  try {
    const original = await Bun.file(sourceAbs).bytes();
    const small = await downscaleJpeg(original);
    if (small.bytes === original) return { ...base, path: sourceAbs, mimeType: "image/jpeg", problem: null };
    await media.write(cacheRel, small.bytes).catch(async (e) => {
      // written meanwhile by another run: fine, it is the same picture
      if (!(await Bun.file(cacheAbs).exists())) throw e;
    });
    return { ...base, path: cacheAbs, mimeType: "image/jpeg", problem: null };
  } catch (e) {
    console.warn(`capture ${c.id}: no downscaled copy (${(e as Error).message}); using the original`);
    return { ...base, path: sourceAbs, mimeType: "image/jpeg", problem: null };
  }
}

export interface PromptInput {
  mealId: string;
  photos: AgentPhoto[];
  /** Audio captures whose transcription failed. */
  failedTranscripts: { captureId: string; error: string | null }[];
  /** The number of the meal's current revision, if it has one (a re-analysis). */
  currentRevision: number | null;
  timeZone: string;
}

/**
 * The job's prompt: what to do with which meal, plus the photos (as ACP image blocks when the
 * harness takes images, else their paths). Everything else the agent reads with `get_meal`.
 */
export async function buildPrompt(
  input: PromptInput,
  capabilities: acp.AgentCapabilities,
): Promise<acp.ContentBlock[]> {
  const images = capabilities.promptCapabilities?.image === true;
  const showable = input.photos.filter((p) => p.path !== null);
  const attached: { photo: AgentPhoto; data: string }[] = [];
  if (images) {
    for (const photo of showable) {
      if (attached.length >= MAX_ATTACHED_PHOTOS) break;
      const file = Bun.file(photo.path!);
      if (photo.mimeType !== "image/jpeg" && file.size > MAX_RAW_IMAGE_BYTES) continue;
      attached.push({ photo, data: Buffer.from(await file.bytes()).toString("base64") });
    }
  }
  const listed = showable.filter((p) => !attached.some((a) => a.photo === p));
  const when = (ms: number) => isoLocal(ms, input.timeZone);

  const lines = [
    `Analyse meal ${input.mealId} and save the result as its new revision, following the log-meal instructions.`,
    "",
    `- Start with get_meal (mealId "${input.mealId}"): it has every capture, transcripts of voice memos, notes, links, corrections, answers and earlier revisions.`,
  ];
  if (input.currentRevision !== null) {
    lines.push(
      `- This is a re-analysis: revision ${input.currentRevision} exists. Start from it and apply what arrived after it (captures marked afterCurrentRevision, corrections, answers).`,
    );
  }
  if (attached.length) {
    lines.push(
      `- ${attached.length === 1 ? "One photo" : `${attached.length} photos`} of this meal ${attached.length === 1 ? "is" : "are"} attached below, each after a line with its capture id.`,
    );
  }
  if (listed.length) {
    lines.push(
      `- ${attached.length ? "More photos" : "Photos"} of this meal, to open with your file-reading tool:`,
      ...listed.map((p) => `  - capture ${p.captureId} (taken ${when(p.takenAt)}): ${p.path}`),
    );
  }
  for (const p of input.photos.filter((x) => x.path === null)) {
    lines.push(`- Photo ${p.captureId} can't be shown (${p.problem}); work from the other captures.`);
  }
  for (const t of input.failedTranscripts) {
    lines.push(
      `- Voice memo ${t.captureId} could not be transcribed${t.error ? ` (${t.error})` : ""}: work from the other captures and say in an assumption that it was not available.`,
    );
  }
  lines.push(
    "- Finish with exactly one save_meal_revision call; yamt computes the totals, so don't state any yourself.",
  );

  const blocks: acp.ContentBlock[] = [{ type: "text", text: lines.join("\n") }];
  for (const { photo, data } of attached) {
    blocks.push({ type: "text", text: `Photo ${photo.captureId} (taken ${when(photo.takenAt)}):` });
    blocks.push({ type: "image", mimeType: photo.mimeType ?? "image/jpeg", data });
  }
  return blocks;
}

/** Failed transcripts of the live audio captures, for the prompt. */
export function failedTranscripts(
  captures: CaptureRecord[],
  transcripts: Map<string, Transcript>,
): PromptInput["failedTranscripts"] {
  return captures
    .filter((c) => c.kind === "audio")
    .flatMap((c) => {
      const t = transcripts.get(c.id);
      if (t && t.status !== "failed") return [];
      return [{ captureId: c.id, error: t?.error ?? (t ? null : "no transcript") }];
    });
}
