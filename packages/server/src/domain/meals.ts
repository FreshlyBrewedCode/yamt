import {
  type AnalyseResponse,
  type CaptureResponse,
  type CreateMealBody,
  type JsonCaptureBody,
  MAX_UPLOAD_BYTES,
  type Meal,
  type MealDetailResponse,
  type MealSummary,
  type MealsQuery,
  type RetractResponse,
  type UploadCaptureFields,
} from "@yamt/shared";
import { newId } from "../db/index.ts";
import { type NewCapture, toCapture } from "../db/repos/captures.ts";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys } from "../db/repos/jobs.ts";
import { detectMediaType, isHeif, kindForMime, mimeFitsKind } from "../media/detect.ts";
import { exifTakenAt } from "../media/exif.ts";
import { heicToJpeg } from "../media/heic.ts";
import type { MediaStore } from "../media/store.ts";
import { HttpError } from "./errors.ts";
import type { RevisionService } from "./revisions.ts";

/** How far a client clock may run ahead before its `capturedAt` is refused. */
const CLOCK_SKEW_MS = 60 * 60_000;

export interface MediaFile {
  /** Absolute. */
  path: string;
  mimeType: string;
  byteSize: number;
  /** Strong validator for caching and range requests. */
  etag: string;
}

/**
 * Meals and their captures: the rules the routes (and later the agent's tools) go through.
 * Captures are only ever added or retracted. An audio capture gets a pending transcript and a
 * `transcribe` job; analysing a meal queues it and enqueues one `analyse` job.
 */
export class MealService {
  constructor(
    private readonly repos: Repos,
    private readonly media: MediaStore,
    private readonly revisions: RevisionService,
    /** Seam for tests: the HEIC → JPEG conversion. */
    private readonly toJpeg: (heic: Uint8Array) => Promise<Uint8Array> = heicToJpeg,
  ) {}

  create(body: CreateMealBody): Meal {
    return this.repos.meals.insert({ eatenAt: body.eatenAt });
  }

  list(q: MealsQuery): MealSummary[] {
    return this.repos.meals.list(q);
  }

  detail(id: string): MealDetailResponse {
    const meal = this.meal(id);
    return {
      meal,
      captures: this.repos.captures.listForMeal(id).map(toCapture),
      transcripts: this.repos.transcripts.listForMeal(id),
      revision: this.revisions.current(meal),
    };
  }

  /**
   * Text, link, correction and answer captures. An answer may name the question it answers,
   * which must be one of the meal's current revision (older questions were superseded).
   */
  addJson(mealId: string, body: JsonCaptureBody, now = Date.now()): CaptureResponse {
    const meal = this.meal(mealId);
    checkCapturedAt(body.capturedAt, now);
    const questionId = body.kind === "answer" ? (body.questionId ?? null) : null;
    if (questionId !== null) {
      const question = this.repos.revisions.question(questionId);
      if (!question || question.revisionId !== meal.currentRevisionId) {
        throw new HttpError(
          400,
          "questionId: not a question of this meal's current analysis",
          "answer one of the questions in the meal's current revision",
        );
      }
    }
    return this.record({
      id: newId(),
      mealId,
      kind: body.kind,
      capturedAt: body.capturedAt ?? null,
      text: body.text ?? null,
      url: body.kind === "link" ? body.url : null,
      questionId,
      now,
    });
  }

  /**
   * Audio, image and file uploads. The original is stored byte for byte; photos get their EXIF
   * time, HEIC/HEIF photos a JPEG derivative next to the original (or `missing` if that fails).
   */
  async addUpload(
    mealId: string,
    file: File,
    fields: UploadCaptureFields,
    now = Date.now(),
  ): Promise<CaptureResponse> {
    this.meal(mealId);
    checkCapturedAt(fields.capturedAt, now);
    if (file.size === 0) throw new HttpError(400, "the file is empty");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    }
    const bytes = await file.bytes();
    const fileName = file.name ? file.name.slice(0, 255) : null;
    const type = detectMediaType(bytes.subarray(0, 64), file.type, fileName, fields.kind);
    const kind = fields.kind ?? kindForMime(type.mimeType);
    if (!mimeFitsKind(type.mimeType, kind)) {
      throw new HttpError(400, `a ${type.mimeType} file is not ${kind === "image" ? "an image" : "audio"}`);
    }

    const id = newId();
    const path = this.media.pathFor(id, type.ext, now);
    const written: string[] = [];
    try {
      const { byteSize, sha256 } = await this.media.write(path, bytes);
      written.push(path);
      let takenAt: number | null = null;
      let jpeg: { status: "ok"; path: string } | { status: "missing" } | null = null;
      if (kind === "image") {
        takenAt = await exifTakenAt(bytes);
        if (isHeif(type.mimeType)) {
          const jpegPath = this.media.pathFor(id, "jpg", now);
          try {
            await this.media.write(jpegPath, await this.toJpeg(bytes));
            written.push(jpegPath);
            jpeg = { status: "ok", path: jpegPath };
          } catch (e) {
            console.warn(`capture ${id}: no JPEG derivative (${(e as Error).message}); the original is kept`);
            jpeg = { status: "missing" };
          }
        }
      }
      return this.record({
        id,
        mealId,
        kind,
        capturedAt: fields.capturedAt ?? null,
        takenAt,
        media: { mimeType: type.mimeType, path, byteSize, sha256, fileName, jpeg },
        now,
      });
    } catch (e) {
      // nothing points at the files: don't leave orphans
      for (const p of written) await this.media.remove(p).catch(() => {});
      throw e;
    }
  }

  /** Soft retraction; idempotent. A retracted audio capture's queued transcription is cancelled. */
  retract(captureId: string, now = Date.now()): RetractResponse {
    const existing = this.repos.captures.get(captureId);
    if (!existing) throw new HttpError(404, "capture not found");
    return this.repos.db.transaction(() => {
      const capture = this.repos.captures.retract(captureId, now)!;
      if (capture.kind === "audio") {
        this.repos.jobs.cancelQueued(dedupeKeys.transcribe(captureId), "capture retracted", now);
      }
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      const meal = this.repos.meals.capturesChanged(capture.mealId, now)!;
      return { capture: toCapture(capture), meal };
    })();
  }

  /**
   * Queues the meal for analysis. Idempotent while a job is queued; while one runs, a new one
   * is queued behind it (it may have missed the latest captures).
   */
  analyse(mealId: string, now = Date.now()): AnalyseResponse {
    this.meal(mealId);
    if (this.repos.captures.countLive(mealId) === 0) {
      throw new HttpError(409, "nothing to analyse yet", "add a capture first");
    }
    return this.repos.db.transaction(() => {
      const { job } = this.repos.jobs.enqueue(
        "analyse",
        { mealId },
        { dedupeKey: dedupeKeys.analyse(mealId), now },
      );
      const meal = this.repos.meals.setStatus(mealId, "queued", now)!;
      return { meal, jobId: job.id };
    })();
  }

  /** The stored file of a media capture: the original, or the JPEG derivative of a HEIC photo. */
  mediaFile(captureId: string, variant: "original" | "jpeg"): MediaFile {
    const c = this.repos.captures.get(captureId);
    if (!c) throw new HttpError(404, "capture not found");
    if (variant === "jpeg") {
      if (!c.jpegPath) throw new HttpError(404, "this capture has no JPEG derivative");
      const path = this.media.absolute(c.jpegPath);
      return { path, mimeType: "image/jpeg", byteSize: Bun.file(path).size, etag: `"${c.sha256}-jpeg"` };
    }
    if (!c.mediaPath || !c.mimeType || c.byteSize === null)
      throw new HttpError(404, "this capture has no media");
    return {
      path: this.media.absolute(c.mediaPath),
      mimeType: c.mimeType,
      byteSize: c.byteSize,
      etag: `"${c.sha256}"`,
    };
  }

  private meal(id: string): Meal {
    const meal = this.repos.meals.get(id);
    if (!meal) throw new HttpError(404, "meal not found");
    return meal;
  }

  /** One transaction: the capture, for audio its transcript and job, and the meal's times. */
  private record(c: NewCapture): CaptureResponse {
    return this.repos.db.transaction(() => {
      const capture = this.repos.captures.insert(c);
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      let transcript = null;
      if (capture.kind === "audio") {
        transcript = this.repos.transcripts.upsertPending(capture.id, c.now);
        this.repos.jobs.enqueue(
          "transcribe",
          { captureId: capture.id },
          { dedupeKey: dedupeKeys.transcribe(capture.id), now: c.now },
        );
      }
      const meal = this.repos.meals.capturesChanged(capture.mealId, c.now)!;
      return { capture: toCapture(capture), transcript, meal };
    })();
  }
}

function checkCapturedAt(capturedAt: number | undefined, now: number): void {
  if (capturedAt !== undefined && capturedAt > now + CLOCK_SKEW_MS) {
    throw new HttpError(400, "capturedAt lies in the future", "check the device clock");
  }
}
