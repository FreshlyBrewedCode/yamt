import {
  type AnalyseResponse,
  type CaptureResponse,
  type CreateMealBody,
  type DayTotals,
  isVoice,
  type JsonCaptureBody,
  MAX_UPLOAD_BYTES,
  type Meal,
  type MealDetailResponse,
  type MealItem,
  type MealRevisionsResponse,
  type MealSummary,
  type MealsQuery,
  type MealsResponse,
  type NutrientTotals,
  type RetractResponse,
  type TranscribeResponse,
  type UpdateMealBody,
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
import { type RevisionService, totalsOf } from "./revisions.ts";
import { assertTimeZone, localDate, localTimeZone } from "./time.ts";

/** How far a client clock may run ahead before its `capturedAt` (or an `eatenAt`) is refused. */
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
    private readonly revisionService: RevisionService,
    /** Seam for tests: the HEIC → JPEG conversion. */
    private readonly toJpeg: (heic: Uint8Array) => Promise<Uint8Array> = heicToJpeg,
    /** Called after a job was enqueued, so the worker picks it up without waiting for its tick. */
    private readonly jobsChanged: () => void = () => {},
  ) {}

  /**
   * A new draft. With a client `id` it is idempotent: an existing meal with that id is answered
   * as it is (`created: false`), so a retried request never makes a second meal.
   */
  ensure(body: CreateMealBody): { meal: Meal; created: boolean } {
    if (body.id) {
      const existing = this.repos.meals.get(body.id);
      if (existing) return { meal: existing, created: false };
    }
    return { meal: this.repos.meals.insert({ id: body.id, eatenAt: body.eatenAt }), created: true };
  }

  create(body: CreateMealBody): Meal {
    return this.ensure(body).meal;
  }

  /**
   * The overview: meals with what they hold and their current revision's title, totals and open
   * questions, plus each day's totals (in `tz`) over those meals. Totals come from `totalsOf`.
   */
  list(q: MealsQuery): MealsResponse {
    const timeZone = q.tz ?? localTimeZone();
    try {
      assertTimeZone(timeZone);
    } catch {
      throw new HttpError(400, `tz: unknown time zone ${timeZone}`, "an IANA zone like Europe/Berlin");
    }
    const days = new Map<string, { meals: number; unanalysed: number; items: MealItem[] }>();
    const meals: MealSummary[] = this.repos.meals.list(q).map((m) => {
      const view = this.revisionService.current(m);
      const date = localDate(m.eatenAt, timeZone);
      const day = days.get(date) ?? { meals: 0, unanalysed: 0, items: [] };
      days.set(date, day);
      day.meals++;
      if (view) day.items.push(...view.items);
      else day.unanalysed++;
      return {
        ...m,
        title: view?.revision.title ?? null,
        totals: view ? nutrientTotals(view.totals) : null,
        openQuestions: view?.questions.filter((x) => x.answeredByCaptureId === null).length ?? 0,
      };
    });
    const dayTotals: DayTotals[] = [...days].map(([date, d]) => ({
      date,
      meals: d.meals,
      unanalysed: d.unanalysed,
      totals: nutrientTotals(totalsOf(d.items)),
    }));
    return { meals, days: dayTotals, timeZone };
  }

  detail(id: string): MealDetailResponse {
    const meal = this.meal(id);
    return {
      meal,
      captures: this.repos.captures.listForMeal(id).map(toCapture),
      transcripts: this.repos.transcripts.listForMeal(id),
      revision: this.revisionService.current(meal),
      runs: this.repos.runs.listForMeal(id),
    };
  }

  /** Every revision of the meal, newest first, with totals computed from its own items. */
  revisions(mealId: string): MealRevisionsResponse {
    this.meal(mealId);
    const revisions = this.repos.revisions
      .listForMeal(mealId)
      .reverse()
      .flatMap((r) => this.revisionService.view(r.id) ?? []);
    return { revisions };
  }

  /**
   * Sets when the meal was eaten. A time pins it (`user`: captures and the analysis leave it
   * alone from now on); `null` unpins it, and it follows the captures again.
   */
  update(mealId: string, body: UpdateMealBody, now = Date.now()): Meal {
    this.meal(mealId);
    if (body.eatenAt === null) return this.repos.meals.unpinEatenAt(mealId, now)!;
    if (body.eatenAt > now + CLOCK_SKEW_MS) {
      throw new HttpError(400, "eatenAt lies in the future", "check the device clock");
    }
    return this.repos.meals.setEatenAt(mealId, body.eatenAt, "user", now)!;
  }

  /**
   * Text, link, correction and answer captures. An answer may name the question it answers,
   * which must be one of the meal's current revision (older questions were superseded).
   */
  addJson(mealId: string, body: JsonCaptureBody, now = Date.now()): CaptureResponse & { created: boolean } {
    const meal = this.meal(mealId);
    const existing = this.existing(mealId, body.id);
    if (existing) return existing;
    checkCapturedAt(body.capturedAt, now);
    const questionId = this.questionOf(meal, body.kind === "answer" ? body.questionId : undefined);
    return this.record({
      id: body.id ?? newId(),
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
   * Audio, image and file uploads, and spoken answers and corrections (audio only). The original
   * is stored byte for byte; photos get their EXIF time, HEIC/HEIF photos a JPEG derivative next
   * to the original (or `missing` if that fails); speech gets a pending transcript.
   */
  async addUpload(
    mealId: string,
    file: File,
    fields: UploadCaptureFields,
    now = Date.now(),
  ): Promise<CaptureResponse & { created: boolean }> {
    const meal = this.meal(mealId);
    const existing = this.existing(mealId, fields.id);
    if (existing) return existing;
    checkCapturedAt(fields.capturedAt, now);
    if (fields.questionId !== undefined && fields.kind !== "answer") {
      throw new HttpError(400, "questionId: only an answer answers a question");
    }
    const questionId = this.questionOf(meal, fields.questionId);
    if (file.size === 0) throw new HttpError(400, "the file is empty");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    }
    const bytes = await file.bytes();
    const fileName = file.name ? file.name.slice(0, 255) : null;
    // a spoken answer or correction is audio as far as the file goes
    const asked = fields.kind;
    const mediaKind = asked === "answer" || asked === "correction" ? "audio" : asked;
    const type = detectMediaType(bytes.subarray(0, 64), file.type, fileName, mediaKind);
    const kind = asked ?? kindForMime(type.mimeType);
    if (mediaKind && !mimeFitsKind(type.mimeType, mediaKind)) {
      throw new HttpError(
        400,
        `a ${type.mimeType} file is not ${mediaKind === "image" ? "an image" : "audio"}`,
      );
    }

    const id = fields.id ?? newId();
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
        questionId,
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
      if (isVoice(capture)) {
        this.repos.jobs.cancelQueued(dedupeKeys.transcribe(captureId), "capture retracted", now);
      }
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      const meal = this.repos.meals.capturesChanged(capture.mealId, now)!;
      return { capture: toCapture(capture), meal };
    })();
  }

  /**
   * Runs an audio capture's transcription again (e.g. after a model change): the transcript goes
   * back to `pending` (the old text is dropped; the audio is never touched) and a `transcribe` job
   * is queued, or the queued one reused. An analysis of the meal that is queued waits for it; an
   * analysed meal is not analysed again by this (that's the user's call).
   */
  retranscribe(captureId: string, now = Date.now()): TranscribeResponse {
    const capture = this.repos.captures.get(captureId);
    if (!capture) throw new HttpError(404, "capture not found");
    if (!isVoice(capture)) throw new HttpError(400, "only voice captures have a transcript");
    if (capture.retractedAt !== null) throw new HttpError(409, "the capture was retracted");
    const res = this.repos.db.transaction(() => {
      const transcript = this.repos.transcripts.upsertPending(captureId, now);
      const { job } = this.repos.jobs.enqueue(
        "transcribe",
        { captureId },
        { dedupeKey: dedupeKeys.transcribe(captureId), now },
      );
      return { capture: toCapture(capture), transcript, jobId: job.id };
    })();
    this.jobsChanged();
    return res;
  }

  /**
   * Queues the meal for analysis. Idempotent while a job is queued; while one runs, a new one
   * is queued behind it (it may have missed the latest captures). On a `failed` meal this is the
   * retry: a fresh job with fresh attempts, and the error is cleared.
   */
  analyse(mealId: string, now = Date.now()): AnalyseResponse {
    this.meal(mealId);
    if (this.repos.captures.countLive(mealId) === 0) {
      throw new HttpError(409, "nothing to analyse yet", "add a capture first");
    }
    const result = this.repos.db.transaction(() => {
      const { job } = this.repos.jobs.enqueue(
        "analyse",
        { mealId },
        { dedupeKey: dedupeKeys.analyse(mealId), now },
      );
      const meal = this.repos.meals.setStatus(mealId, "queued", now)!;
      return { meal, jobId: job.id };
    })();
    this.jobsChanged();
    return result;
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

  /**
   * A retried create: the capture with the client's id, if it is already stored (for this meal;
   * an id of another meal's capture is a conflict).
   */
  private existing(mealId: string, id: string | undefined): (CaptureResponse & { created: false }) | null {
    if (!id) return null;
    const c = this.repos.captures.get(id);
    if (!c) return null;
    if (c.mealId !== mealId) throw new HttpError(409, "id: a capture of another meal has this id");
    return {
      capture: toCapture(c),
      transcript: isVoice(c) ? this.repos.transcripts.get(id) : null,
      meal: this.meal(mealId),
      created: false,
    };
  }

  /** The question an answer names: it must be one of the meal's current revision. */
  private questionOf(meal: Meal, questionId: string | undefined): string | null {
    if (questionId === undefined) return null;
    const question = this.repos.revisions.question(questionId);
    if (!question || question.revisionId !== meal.currentRevisionId) {
      throw new HttpError(
        400,
        "questionId: not a question of this meal's current analysis",
        "answer one of the questions in the meal's current revision",
      );
    }
    return questionId;
  }

  private meal(id: string): Meal {
    const meal = this.repos.meals.get(id);
    if (!meal) throw new HttpError(404, "meal not found");
    return meal;
  }

  /** One transaction: the capture, for audio its transcript and job, and the meal's times. */
  private record(c: NewCapture): CaptureResponse & { created: true } {
    const res = this.repos.db.transaction(() => {
      const capture = this.repos.captures.insert(c);
      if (capture.questionId) this.repos.revisions.refreshAnswer(capture.questionId);
      let transcript = null;
      if (isVoice(capture)) {
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
    if (res.transcript) this.jobsChanged();
    return { ...res, created: true };
  }
}

export const nutrientTotals = ({ grams, items, nutrients }: NutrientTotals): NutrientTotals => ({
  grams,
  items,
  nutrients,
});

export function checkCapturedAt(capturedAt: number | undefined, now: number): void {
  if (capturedAt !== undefined && capturedAt > now + CLOCK_SKEW_MS) {
    throw new HttpError(400, "capturedAt lies in the future", "check the device clock");
  }
}
