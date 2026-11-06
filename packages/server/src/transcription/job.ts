import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isVoice } from "@yamt/shared";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys, type Job, type JobPayloads } from "../db/repos/jobs.ts";
import { isVoiceInput } from "../db/repos/planning-inputs.ts";
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

type TranscribePayload = JobPayloads["transcribe"];

/**
 * What a `transcribe` job transcribes: a voice capture (`{captureId}`) or a voice planning input
 * (`{inputId}`, #44). Both have their media stored the same way and a transcript of the same
 * shape; only the table and what waits for it differ.
 */
interface VoiceSource {
  id: string;
  /** Its job's dedupe key: a queued one is a re-run that wins over this one. */
  key: string;
  /** Relative to the data dir; null when it can't be transcribed (then `refuse` says why). */
  mediaPath: string | null;
  refuse: string | null;
}

function voiceSource(repos: Repos, p: TranscribePayload): VoiceSource {
  if ("inputId" in p) {
    const i = repos.planningInputs.get(p.inputId);
    const refuse = !i
      ? `planning input ${p.inputId} not found`
      : !isVoiceInput(i) || !i.mediaPath
        ? `planning input ${p.inputId} is not a voice input`
        : i.retractedAt !== null
          ? "the input was retracted"
          : null;
    return {
      id: p.inputId,
      key: dedupeKeys.transcribeInput(p.inputId),
      mediaPath: i?.mediaPath ?? null,
      refuse,
    };
  }
  const c = repos.captures.get(p.captureId);
  const refuse = !c
    ? `capture ${p.captureId} not found`
    : !isVoice(c) || !c.mediaPath
      ? `capture ${p.captureId} is not a voice capture`
      : c.retractedAt !== null
        ? "the capture was retracted"
        : null;
  return {
    id: p.captureId,
    key: dedupeKeys.transcribe(p.captureId),
    mediaPath: c?.mediaPath ?? null,
    refuse,
  };
}

/** The transcript table of the payload's kind of source. */
const transcriptsOf = (repos: Repos, p: TranscribePayload) =>
  "inputId" in p ? repos.planningTranscripts : repos.transcripts;

const sourceId = (p: TranscribePayload): string => ("inputId" in p ? p.inputId : p.captureId);

/**
 * The `transcribe` job: a voice capture's (or voice planning input's) original → ffmpeg → 16 kHz mono WAV in a temp dir →
 * the STT backend → its transcript (`done` with text, model, language, duration, segments).
 * The original is only read. Due jobs run as one batch (one STT process, one model load), one
 * batch at a time; the analysis may run alongside.
 *
 * A finished transcript lets a waiting analysis of its meal (or the `plan` job of its planning
 * request) go at once (`nudgeWaiting`) rather than at its next 15 s look. A failure is retried
 * with the queue's backoff (30 s, 2 min) while the transcript stays `pending`; after the last
 * attempt (or at once when retrying can't help: a file ffmpeg can't read, a missing tool) it is
 * `failed` with the error, and what waits for it proceeds without it. A server stop runs unfinished items again at the next start, no attempt
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
    const bySource = new Map<string, JobOf<"transcribe">>();
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
        if (signal.aborted) {
          outcomes.set(job.id, stopped());
          continue;
        }
        const source = voiceSource(repos, job.payload);
        if (source.refuse || !source.mediaPath) {
          outcomes.set(job.id, { status: "failed", error: source.refuse ?? "no media", retryable: false });
          continue;
        }
        const id = source.id;
        const wav = join(dir, `${id}.wav`);
        try {
          ffmpeg ??= await this.o.ffmpeg();
          await normalise(ffmpeg, media.absolute(source.mediaPath), wav, { signal });
        } catch (e) {
          if (signal.aborted) outcomes.set(job.id, stopped());
          else {
            const retryable = e instanceof NormaliseError ? e.retryable : !(e instanceof ToolMissingError);
            outcomes.set(job.id, { status: "failed", error: (e as Error).message, retryable });
          }
          continue;
        }
        bySource.set(id, job);
        items.push({ id, path: wav });
      }

      if (items.length > 0) {
        const end = await this.o.backend.transcribe(items, {
          signal,
          onResult: (id, r) => {
            const job = bySource.get(id);
            if (job && !outcomes.has(job.id)) outcomes.set(job.id, this.store(job, r));
          },
        });
        for (const item of items) {
          const job = bySource.get(item.id)!;
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

  /** A result as it arrives: the transcript is written at once, so whatever waits for it can go. */
  private store(job: JobOf<"transcribe">, r: SttResult): JobOutcome {
    if (!r.ok) return { status: "failed", error: r.error };
    const { repos } = this.s;
    const { id, key } = voiceSource(repos, job.payload);
    // a re-run was requested while this one ran: its result replaces ours anyway
    if (repos.jobs.hasQueued(key)) return { status: "done" };
    const now = this.now();
    transcriptsOf(repos, job.payload).complete(
      id,
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
        `transcription: ${id}: ${(r.durationMs / 1000).toFixed(1)} s of audio in ${(r.elapsedMs / 1000).toFixed(1)} s (RTF ${(r.elapsedMs / r.durationMs).toFixed(2)})`,
      );
    }
    nudgeWaiting(this.s, job.payload, now);
    return { status: "done" };
  }

  settled(job: JobOf<"transcribe">, outcome: JobOutcome): void {
    if (outcome.status === "failed") {
      const next = job.status === "queued" ? `, retrying at ${new Date(job.runAfter).toISOString()}` : "";
      this.log(
        `transcription: ${sourceId(job.payload)} failed (attempt ${job.attempts}${next}): ${outcome.error}`,
      );
    }
    if (settleTranscript(this.s.repos, job, this.now())) nudgeWaiting(this.s, job.payload, this.now());
  }
}

/**
 * After a transcribe job's final failure: the transcript is `failed` with the error, unless a
 * newer job for it is queued (a re-run). Returns whether it was marked. Also used at startup for
 * jobs an earlier process left running that have no attempts left.
 */
export function settleTranscript(repos: Repos, job: Job, now = Date.now()): boolean {
  if (job.type !== "transcribe" || job.status !== "failed") return false;
  const { id, key } = voiceSource(repos, job.payload);
  if (repos.jobs.hasQueued(key)) return false;
  const transcripts = transcriptsOf(repos, job.payload);
  if (transcripts.get(id)?.status !== "pending") return false;
  transcripts.fail(id, job.lastError ?? "the transcription failed", now);
  return true;
}

/**
 * Something may wait for this transcript: the analysis of the capture's meal, or the `plan` job
 * of the input's request once the input is in a round. Make it due and poke the worker.
 */
export function nudgeWaiting(s: Services, p: TranscribePayload, now = Date.now()): void {
  if ("inputId" in p) {
    const input = s.repos.planningInputs.get(p.inputId);
    if (input?.roundId && s.repos.jobs.expedite(dedupeKeys.plan(input.requestId), now)) s.queue.wake();
    return;
  }
  const capture = s.repos.captures.get(p.captureId);
  if (!capture) return;
  if (s.repos.jobs.expedite(dedupeKeys.analyse(capture.mealId), now)) s.queue.wake();
}
