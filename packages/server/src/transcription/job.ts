import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys, type Job } from "../db/repos/jobs.ts";
import type { JobContext, JobHandler, JobOf, JobOutcome } from "../jobs/worker.ts";
import type { Services } from "../services.ts";
import type { SttBackend, SttItem, SttResult } from "./backend.ts";
import { NormaliseError, normalise } from "./ffmpeg.ts";
import { ToolMissingError } from "./tools.ts";

export interface TranscribeOptions {
  backend: SttBackend;
  /** The ffmpeg binary; resolved on first use (it may be linked from nixpkgs then). */
  ffmpeg: () => Promise<string>;
  /** Most jobs one STT process takes on (the model loads once per batch). */
  batchSize?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * The `transcribe` job: an audio capture's original → ffmpeg → 16 kHz mono WAV in a temp dir →
 * the STT backend → its transcript (`done` with text, model, language, duration, segments).
 * The original is only read. Due jobs run as one batch (one STT process, one model load), one
 * batch at a time; the analysis may run alongside.
 *
 * A finished transcript lets a waiting analysis of its meal go at once (`nudgeAnalysis`) rather
 * than at its next 15 s look. A failure is retried with the queue's backoff (30 s, 2 min) while
 * the transcript stays `pending`; after the last attempt (or at once when retrying can't help: a
 * file ffmpeg can't read, a missing tool) it is `failed` with the error, and the analysis
 * proceeds without it. A server stop runs unfinished items again at the next start, no attempt
 * spent. A re-run requested meanwhile (a newer queued job) wins: this run's result is dropped.
 */
export class TranscribeJob implements JobHandler<"transcribe"> {
  readonly type = "transcribe";
  readonly concurrency = 1;
  readonly batchSize: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly s: Services,
    private readonly o: TranscribeOptions,
  ) {
    this.batchSize = o.batchSize ?? 8;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((l) => console.log(l));
  }

  async run(job: JobOf<"transcribe">, ctx: JobContext): Promise<JobOutcome> {
    return (await this.runBatch([job], ctx))[0]!;
  }

  async runBatch(jobs: JobOf<"transcribe">[], { signal }: JobContext): Promise<JobOutcome[]> {
    const { repos, media } = this.s;
    const outcomes = new Map<string, JobOutcome>();
    const byCapture = new Map<string, JobOf<"transcribe">>();
    const stopped = (): JobOutcome => ({
      status: "reschedule",
      runAfter: this.now(),
      reason: "server stopped",
    });

    const dir = await mkdtemp(join(tmpdir(), "yamt-stt-"));
    try {
      let ffmpeg: string | null = null;
      const items: SttItem[] = [];
      for (const job of jobs) {
        const { captureId } = job.payload;
        if (signal.aborted) {
          outcomes.set(job.id, stopped());
          continue;
        }
        const c = repos.captures.get(captureId);
        const refuse = !c
          ? `capture ${captureId} not found`
          : c.kind !== "audio" || !c.mediaPath
            ? `capture ${captureId} is not an audio capture`
            : c.retractedAt !== null
              ? "the capture was retracted"
              : null;
        if (refuse || !c?.mediaPath) {
          outcomes.set(job.id, { status: "failed", error: refuse ?? "no media", retryable: false });
          continue;
        }
        const wav = join(dir, `${captureId}.wav`);
        try {
          ffmpeg ??= await this.o.ffmpeg();
          await normalise(ffmpeg, media.absolute(c.mediaPath), wav, { signal });
        } catch (e) {
          if (signal.aborted) outcomes.set(job.id, stopped());
          else {
            const retryable = e instanceof NormaliseError ? e.retryable : !(e instanceof ToolMissingError);
            outcomes.set(job.id, { status: "failed", error: (e as Error).message, retryable });
          }
          continue;
        }
        byCapture.set(captureId, job);
        items.push({ id: captureId, path: wav });
      }

      if (items.length > 0) {
        const end = await this.o.backend.transcribe(items, {
          signal,
          onResult: (captureId, r) => {
            const job = byCapture.get(captureId);
            if (job && !outcomes.has(job.id)) outcomes.set(job.id, this.store(job, r));
          },
        });
        for (const item of items) {
          const job = byCapture.get(item.id)!;
          if (outcomes.has(job.id)) continue;
          outcomes.set(
            job.id,
            end.status === "aborted"
              ? stopped()
              : end.status === "error"
                ? { status: "failed", error: end.error, retryable: end.retryable }
                : { status: "failed", error: "the STT process gave no result for this file" },
          );
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return jobs.map((j) => outcomes.get(j.id) ?? stopped());
  }

  /** A result as it arrives: the transcript is written at once, so a waiting analysis can go. */
  private store(job: JobOf<"transcribe">, r: SttResult): JobOutcome {
    if (!r.ok) return { status: "failed", error: r.error };
    const { repos } = this.s;
    const { captureId } = job.payload;
    // a re-run was requested while this one ran: its result replaces ours anyway
    if (repos.jobs.hasQueued(dedupeKeys.transcribe(captureId))) return { status: "done" };
    const now = this.now();
    repos.transcripts.complete(
      captureId,
      {
        text: r.text,
        model: r.model,
        language: r.language,
        durationMs: r.durationMs,
        segments: r.segments,
        elapsedMs: r.elapsedMs,
        settings: r.settings,
      },
      now,
    );
    if (r.durationMs && r.elapsedMs) {
      this.log(
        `transcription: ${captureId}: ${(r.durationMs / 1000).toFixed(1)} s of audio in ${(r.elapsedMs / 1000).toFixed(1)} s (RTF ${(r.elapsedMs / r.durationMs).toFixed(2)})`,
      );
    }
    nudgeAnalysis(this.s, captureId, now);
    return { status: "done" };
  }

  settled(job: JobOf<"transcribe">, outcome: JobOutcome): void {
    if (outcome.status === "failed") {
      const next = job.status === "queued" ? `, retrying at ${new Date(job.runAfter).toISOString()}` : "";
      this.log(
        `transcription: ${job.payload.captureId} failed (attempt ${job.attempts}${next}): ${outcome.error}`,
      );
    }
    if (settleTranscript(this.s.repos, job, this.now()))
      nudgeAnalysis(this.s, job.payload.captureId, this.now());
  }
}

/**
 * After a transcribe job's final failure: the transcript is `failed` with the error, unless a
 * newer job for it is queued (a re-run). Returns whether it was marked. Also used at startup for
 * jobs an earlier process left running that have no attempts left.
 */
export function settleTranscript(repos: Repos, job: Job, now = Date.now()): boolean {
  if (job.type !== "transcribe" || job.status !== "failed") return false;
  const { captureId } = job.payload;
  if (repos.jobs.hasQueued(dedupeKeys.transcribe(captureId))) return false;
  if (repos.transcripts.get(captureId)?.status !== "pending") return false;
  repos.transcripts.fail(captureId, job.lastError ?? "the transcription failed", now);
  return true;
}

/** The capture's meal may have an analysis waiting for this transcript: make it due and poke the worker. */
export function nudgeAnalysis(s: Services, captureId: string, now = Date.now()): void {
  const capture = s.repos.captures.get(captureId);
  if (!capture) return;
  if (s.repos.jobs.expedite(dedupeKeys.analyse(capture.mealId), now)) s.queue.wake();
}
