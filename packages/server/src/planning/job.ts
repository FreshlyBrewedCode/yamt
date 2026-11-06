import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RunStatus } from "@yamt/shared";
import { adapters } from "../acp/adapters/index.ts";
import { httpMcpServer } from "../acp/mcp.ts";
import type * as acp from "../acp/protocol.ts";
import { type PromptRunResult, type RunTimeouts, runPrompt } from "../acp/run.ts";
import { analysisPermissions, isInside, WEB_TOOLS } from "../analysis/permissions.ts";
import { agentPhoto } from "../analysis/prompt.ts";
import { loadSkill } from "../analysis/skill.ts";
import { TraceWriter } from "../analysis/trace.ts";
import { dataPaths } from "../config.ts";
import { newId } from "../db/index.ts";
import type { Job } from "../db/repos/jobs.ts";
import { isVoiceInput } from "../db/repos/planning-inputs.ts";
import { HttpError } from "../domain/errors.ts";
import { REQUEST_ARCHIVED } from "../domain/planning-requests.ts";
import {
  JobCancelled,
  type JobContext,
  type JobHandler,
  type JobOf,
  type JobOutcome,
} from "../jobs/worker.ts";
import { MCP_SERVER_NAME } from "../mcp/endpoint.ts";
import { notifyPlan } from "../push/messages.ts";
import type { Services } from "../services.ts";
import { buildPlanPrompt } from "./prompt.ts";

/** The plan-meals skill: the appended system prompt of every planning run (and the interactive skill). */
export const PLAN_SKILL_PATH = join(import.meta.dir, "../../../../.agents/skills/plan-meals/SKILL.md");

/** A round's turn may take 2 min per suggestion plus 1 min (spike #38: ~35–50 s each), at most 15. */
export const PLAN_TURN_PER_SUGGESTION_MS = 2 * 60_000;
export const PLAN_TURN_BASE_MS = 60_000;
export const PLAN_TURN_MAX_MS = 15 * 60_000;

export const planTurnMs = (count: number): number =>
  Math.min(PLAN_TURN_MAX_MS, PLAN_TURN_BASE_MS + PLAN_TURN_PER_SUGGESTION_MS * count);

/** Why a round whose run saved nothing failed. */
const NOTHING_SAVED = "the agent ended its turn without saving a suggestion";

export interface PlanOptions {
  /** `http://127.0.0.1:<port>/mcp`: the harness connects over loopback. */
  mcpUrl: string;
  /** Overrides (tests); the turn defaults to `planTurnMs(count)`, the idle timeouts to the analysis's. */
  timeouts?: Partial<RunTimeouts>;
  /** How long a round waits before looking at pending transcripts again (default 15 s). */
  transcriptWaitMs?: number;
  skillPath?: string;
  now?: () => number;
}

/** Built-in tools a Claude Code planning run gets: open a photo by path, fetch and search the web. */
const BUILT_IN_TOOLS = ["Read", ...WEB_TOOLS];

/**
 * The `plan` job (#45): one run of the planning agent over one round, outline first, then each
 * suggestion saved as soon as it is done. Per attempt:
 *
 * 1. Waits (reschedules, no attempt spent) while a voice input of the round has a pending
 *    transcript; a transcript that finishes makes the job due at once (`nudgeWaiting`).
 * 2. Creates the run (`planning_runs` row, `<data>/runs/<run id>/` as its cwd and trace), takes
 *    the round (`running`), mints a run token scoped to the round (the planning tools of this
 *    round and the food tools; no meal tools).
 * 3. Drives the harness over ACP: the plan-meals skill as appended system prompt, the planning
 *    agent's harness, model and effort (`AgentService.forPlanning`), web search and fetch, the
 *    request's photos; the turn is capped at `planTurnMs(count)`.
 * 4. The verdict: a round with at least one ready suggestion is `done` (ideas left outlined fail
 *    "didn't complete"), whatever happened after; none ready fails the attempt, and the queue
 *    retries (30 s, 2 min; 3 attempts, the next outline replaces this one), then the round is
 *    `failed` with the reason (`settleRound`). A server stop requeues without spending an
 *    attempt; an archived request stops the run (`cancelled`, the archive failed the round).
 *
 * One at a time (concurrency 1), next to `analyse` and `transcribe`.
 */
export class PlanJob implements JobHandler<"plan"> {
  readonly type = "plan";
  readonly concurrency = 1;
  private readonly now: () => number;

  constructor(
    private readonly s: Services,
    private readonly o: PlanOptions,
  ) {
    this.now = o.now ?? Date.now;
  }

  async run(job: JobOf<"plan">, { signal }: JobContext): Promise<JobOutcome> {
    const { repos } = this.s;
    const { roundId } = job.payload;
    let round = repos.planningRounds.get(roundId);
    if (!round) return { status: "failed", error: `planning round ${roundId} not found`, retryable: false };
    const request = repos.planningRequests.get(round.requestId)!;
    if (request.archivedAt !== null) return { status: "cancelled", reason: REQUEST_ARCHIVED };
    if (round.status === "done" || round.status === "failed") {
      return { status: "cancelled", reason: `the round is ${round.status} already` };
    }
    if (signal.aborted) return { status: "reschedule", runAfter: this.now(), reason: "server stopped" };
    // left running by an attempt that never settled: it is this job's again
    if (round.status === "running") round = this.s.planningRequests.requeueRound(roundId, round.error);

    const inputs = repos.planningInputs.listForRound(roundId).filter((i) => i.retractedAt === null);
    const all = repos.planningInputs.listForRequest(round.requestId).filter((i) => i.retractedAt === null);
    const transcripts = new Map(
      repos.planningTranscripts.listForRequest(round.requestId).map((t) => [t.inputId, t]),
    );
    const pending = inputs.filter((i) => isVoiceInput(i) && transcripts.get(i.id)?.status === "pending");
    if (pending.length > 0) {
      return {
        status: "reschedule",
        runAfter: this.now() + (this.o.transcriptWaitMs ?? 15_000),
        reason: `waiting for ${pending.length === 1 ? "a voice input's transcript" : `${pending.length} transcripts`}`,
      };
    }

    let skill: Awaited<ReturnType<typeof loadSkill>>;
    try {
      skill = await loadSkill(this.o.skillPath ?? PLAN_SKILL_PATH);
    } catch (e) {
      return {
        status: "failed",
        error: `the plan-meals skill can't be read: ${(e as Error).message}`,
        retryable: false,
      };
    }

    // read per run: a change in the app's planning setting applies to the next run
    const { harness, model, effort } = this.s.agent.forPlanning();
    const runId = newId();
    const dir = join(dataPaths(this.s.dataDir).runs, runId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (repos.planningRequests.get(round.requestId)?.archivedAt != null) {
      await rm(dir, { recursive: true, force: true });
      return { status: "cancelled", reason: REQUEST_ARCHIVED };
    }
    const startedAt = this.now();
    repos.planningRuns.insert({
      id: runId,
      roundId,
      jobId: job.id,
      attempt: job.attempts,
      harness: harness.kind,
      model,
      effort,
      startedAt,
    });
    round = this.s.planningRequests.startRound(roundId, runId);
    const token = this.s.mcpTokens.mintPlanRun({ runId, roundId });
    const trace = new TraceWriter(join(dir, "trace.ndjson"), startedAt, [token], this.now);
    trace.write("run.start", {
      runId,
      roundId,
      requestId: round.requestId,
      jobId: job.id,
      attempt: job.attempts,
      harness: harness.kind,
      model,
      effort,
      skill: { path: skill.path, sha256: skill.sha256, text: skill.text },
    });

    let result: PromptRunResult;
    let reply = "";
    try {
      const photos = await Promise.all(
        all.filter((i) => i.kind === "image").map((i) => agentPhoto(i, this.s.media)),
      );
      // what the agent may open: the request's photos (and their downscaled copies), its files
      const readable = new Set([
        ...photos.flatMap((p) => (p.path ? [p.path] : [])),
        ...all.flatMap((i) =>
          [i.mediaPath, i.jpegPath].flatMap((p) => (p && !isVoiceInput(i) ? [this.s.media.absolute(p)] : [])),
        ),
      ]);
      const outline = repos.planningRounds.suggestions(roundId);
      const failedTranscripts = all
        .filter((i) => isVoiceInput(i) && transcripts.get(i.id)?.status !== "done")
        .map((i) => ({ inputId: i.id, error: transcripts.get(i.id)?.error ?? null }));
      const started = round;
      result = await runPrompt({
        harness,
        adapter: adapters[harness.kind],
        cwd: dir,
        systemPrompt: skill.text,
        model,
        effort,
        mcp: {
          servers: [httpMcpServer(MCP_SERVER_NAME, this.o.mcpUrl, token)],
          allowedTools: [`mcp__${MCP_SERVER_NAME}`, ...WEB_TOOLS],
          credential: { server: MCP_SERVER_NAME, token },
        },
        builtInTools: BUILT_IN_TOOLS,
        isolated: true,
        prompt: (caps) =>
          buildPlanPrompt(
            {
              request,
              round: started,
              attempt: job.attempts,
              maxAttempts: job.maxAttempts,
              outline,
              photos,
              failedTranscripts,
            },
            caps,
          ),
        permission: analysisPermissions((p) => readable.has(p) || isInside(p, dir)),
        onEvent: (e) => {
          trace.event(e);
          reply = lastReply(reply, e);
        },
        timeouts: { turnMs: planTurnMs(round.count), ...this.o.timeouts },
        signal,
      });
    } catch (e) {
      // a bug or an I/O error before the harness ran (photos, run dir)
      result = {
        status: "error",
        stopReason: null,
        error: (e as Error).message,
        failure: "error",
        usage: null,
        context: null,
        agentInfo: null,
        model,
        effort: null,
        configNotes: [],
      };
    } finally {
      this.s.mcpTokens.revokeRun(runId);
    }

    const ready = repos.planningRounds.suggestions(roundId).filter((x) => x.status === "ready").length;
    const current = repos.planningRounds.get(roundId);
    // stopped on purpose (the request was archived: the archive ended the round), not by a server stop
    const cancelled =
      signal.reason instanceof JobCancelled
        ? signal.reason.message
        : repos.planningRequests.get(round.requestId)?.archivedAt != null
          ? REQUEST_ARCHIVED
          : current?.status !== "running"
            ? `the round is ${current?.status ?? "gone"}`
            : null;
    const { runStatus, outcome, error } = this.judge(roundId, result, ready, reply, cancelled);
    const endedAt = this.now();
    repos.planningRuns.finish(runId, {
      status: runStatus,
      endedAt,
      model: result.model,
      effort: result.effort,
      configNote: sentence(result.configNotes),
      stopReason: result.stopReason,
      usage: result.usage || result.context ? { turn: result.usage, context: result.context } : null,
      error,
      ready,
    });
    trace.write("run.end", {
      status: runStatus,
      stopReason: result.stopReason,
      ready,
      roundStatus: repos.planningRounds.get(roundId)?.status ?? null,
      error,
      model: result.model,
      effort: result.effort,
      configNotes: result.configNotes,
      usage: result.usage,
      context: result.context,
      durationMs: endedAt - startedAt,
    });
    return outcome;
  }

  settled(job: JobOf<"plan">): void {
    settleRound(this.s, job);
    // done or failed for good: the round's final state; a retry or a reschedule is not the end
    if (job.status === "done" || job.status === "failed") {
      void notifyPlan(this.s, job.payload.roundId).catch((e: unknown) =>
        console.warn(`push: notifying failed: ${(e as Error).message}`),
      );
    }
  }

  /**
   * The run's verdict: a ready suggestion → the round is done (here, at once), whatever happened
   * after; `cancelled` (the request was archived) ends the job without a retry; a server stop
   * reschedules; otherwise the attempt failed with the reason.
   */
  private judge(
    roundId: string,
    r: PromptRunResult,
    ready: number,
    reply: string,
    cancelled: string | null,
  ): { runStatus: Exclude<RunStatus, "running">; outcome: JobOutcome; error: string | null } {
    if (cancelled !== null) {
      return {
        runStatus: "cancelled",
        outcome: { status: "cancelled", reason: cancelled },
        error: `cancelled: ${cancelled}`,
      };
    }
    if (r.status === "cancelled") {
      // the server is stopping: run it again at the next start (what is ready stays), no attempt spent
      return {
        runStatus: "cancelled",
        outcome: { status: "reschedule", runAfter: this.now(), reason: "server stopped during the run" },
        error: "cancelled: the server stopped",
      };
    }
    if (ready > 0) {
      this.s.planningRequests.finishRound(roundId);
      return {
        runStatus: "succeeded",
        outcome: { status: "done" },
        error:
          r.status === "error"
            ? `after saving ${ready} suggestion${ready === 1 ? "" : "s"}: ${r.error}`
            : null,
      };
    }
    let error: string;
    if (r.status === "error") {
      error = r.error ?? "the run failed";
    } else {
      const said = reply.trim().replace(/\s+/g, " ");
      error = `${NOTHING_SAVED} (${r.stopReason})${
        said ? `; it said: "${said.length > 300 ? `${said.slice(0, 300)}…` : said}"` : ""
      }`;
    }
    // a missing harness or login won't fix itself within the backoff
    const retryable = r.failure !== "not_installed" && r.failure !== "auth";
    return { runStatus: "failed", outcome: { status: "failed", error, retryable }, error };
  }
}

/** "Effort max isn't offered …; model …." from the run's notes, null without any. */
function sentence(notes: string[]): string | null {
  const s = notes.join("; ");
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : null;
}

/** The agent's last message: chunks since the last tool call. */
function lastReply(current: string, e: Parameters<Parameters<typeof runPrompt>[0]["onEvent"]>[0]): string {
  if (e.type !== "update") return current;
  const u: acp.SessionUpdate = e.update;
  if (u.sessionUpdate === "agent_message_chunk") {
    return u.content.type === "text" ? current + u.content.text : current;
  }
  if (u.sessionUpdate === "tool_call") return "";
  return current;
}

/**
 * The round's state after its plan job moved on, so a round never stays `running` without a run:
 * a retry or a reschedule (also after a restart: `releaseInterrupted`) puts a running round back
 * to `queued` with the reason; the final failure, or a cancel that left it open, fails it with
 * the error (ideas still outlined fail with it). A round that is done, failed or still queued is
 * left alone.
 */
export function settleRound(s: Services, job: Job): void {
  if (job.type !== "plan") return;
  const round = s.repos.planningRounds.get(job.payload.roundId);
  if (!round || round.status === "done" || round.status === "failed") return;
  try {
    if (job.status === "queued") {
      if (round.status === "running") s.planningRequests.requeueRound(round.id, job.lastError);
    } else if (job.status === "failed" || job.status === "cancelled") {
      s.planningRequests.failRound(round.id, job.lastError ?? "planning failed");
    } else if (job.status === "done" && round.status === "running") {
      if (!s.planningRequests.finishRound(round.id)) s.planningRequests.failRound(round.id, NOTHING_SAVED);
    }
  } catch (e) {
    // an archived request: the archive settled the round already
    if (!(e instanceof HttpError)) throw e;
  }
}
