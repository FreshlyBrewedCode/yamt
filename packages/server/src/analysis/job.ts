import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunStatus } from "@yamt/shared";
import { adapters } from "../acp/adapters/index.ts";
import { httpMcpServer } from "../acp/mcp.ts";
import type * as acp from "../acp/protocol.ts";
import { type PromptRunResult, type RunTimeouts, runPrompt } from "../acp/run.ts";
import { type AnalysisConfig, dataPaths } from "../config.ts";
import { newId } from "../db/index.ts";
import type { Repos } from "../db/repos/index.ts";
import { dedupeKeys, type Job } from "../db/repos/jobs.ts";
import type { JobContext, JobHandler, JobOf, JobOutcome } from "../jobs/worker.ts";
import { MCP_SERVER_NAME } from "../mcp/endpoint.ts";
import type { Services } from "../services.ts";
import { analysisPermissions, isInside, WEB_TOOLS } from "./permissions.ts";
import { agentPhoto, buildPrompt, failedTranscripts } from "./prompt.ts";
import { loadSkill, SKILL_PATH } from "./skill.ts";
import { TraceWriter } from "./trace.ts";

export interface AnalysisOptions {
  config: AnalysisConfig;
  /** `http://127.0.0.1:<port>/mcp`: the harness connects over loopback. */
  mcpUrl: string;
  timeouts?: Partial<RunTimeouts>;
  /** How long an analysis waits before looking at pending transcripts again. */
  transcriptWaitMs?: number;
  skillPath?: string;
  now?: () => number;
}

/** Built-in tools a Claude Code analysis gets: open a photo by path, fetch and search the web. */
const BUILT_IN_TOOLS = ["Read", ...WEB_TOOLS];

/**
 * The `analyse` job: one run of the analysis agent over one meal, ending with exactly one saved
 * revision. Per attempt:
 *
 * 1. Waits (reschedules, no attempt spent) while a live audio capture's transcript is pending; a
 *    failed transcript doesn't block, the prompt mentions it.
 * 2. Creates the run (row + `<data>/runs/<run id>/`, the harness's cwd and trace), sets the meal
 *    `analysing`, mints a run token scoped to the meal.
 * 3. Drives the harness over ACP (`runPrompt`): the log-meal skill as appended system prompt, the
 *    yamt MCP server with the run token, the photos as image blocks.
 * 4. Succeeds only if the run saved a revision (the tool refuses a second one); the revision sets
 *    the meal's status. Otherwise the attempt fails with the reason and the queue retries with
 *    backoff; after the last attempt the meal is `failed` with the error.
 *
 * One at a time (concurrency 1); the queue never runs two jobs of the same meal at once.
 */
export class AnalysisJob implements JobHandler<"analyse"> {
  readonly type = "analyse";
  readonly concurrency = 1;
  private readonly now: () => number;

  constructor(
    private readonly s: Services,
    private readonly o: AnalysisOptions,
  ) {
    this.now = o.now ?? Date.now;
  }

  async run(job: JobOf<"analyse">, { signal }: JobContext): Promise<JobOutcome> {
    const { repos } = this.s;
    const { mealId } = job.payload;
    const meal = repos.meals.get(mealId);
    if (!meal) return { status: "failed", error: `meal ${mealId} not found`, retryable: false };
    if (signal.aborted) return { status: "reschedule", runAfter: this.now(), reason: "server stopped" };

    const captures = repos.captures.listForMeal(mealId).filter((c) => c.retractedAt === null);
    if (captures.length === 0) {
      return { status: "failed", error: "nothing to analyse: every capture was retracted", retryable: false };
    }
    const transcripts = new Map(repos.transcripts.listForMeal(mealId).map((t) => [t.captureId, t]));
    const pending = captures.filter((c) => c.kind === "audio" && transcripts.get(c.id)?.status === "pending");
    if (pending.length > 0) {
      return {
        status: "reschedule",
        runAfter: this.now() + (this.o.transcriptWaitMs ?? 15_000),
        reason: `waiting for ${pending.length === 1 ? "a voice memo's transcript" : `${pending.length} transcripts`}`,
      };
    }

    let skill: Awaited<ReturnType<typeof loadSkill>>;
    try {
      skill = await loadSkill(this.o.skillPath ?? SKILL_PATH);
    } catch (e) {
      return {
        status: "failed",
        error: `the log-meal skill can't be read: ${(e as Error).message}`,
        retryable: false,
      };
    }

    const { harness, model } = this.o.config;
    const runId = newId();
    const dir = join(dataPaths(this.s.dataDir).runs, runId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const startedAt = this.now();
    repos.runs.insert({
      id: runId,
      mealId,
      jobId: job.id,
      attempt: job.attempts,
      harness: harness.kind,
      model,
      startedAt,
    });
    repos.meals.setStatus(mealId, "analysing", startedAt);
    const token = this.s.mcpTokens.mintRun({ runId, mealId });
    const trace = new TraceWriter(join(dir, "trace.ndjson"), startedAt, [token], this.now);
    trace.write("run.start", {
      runId,
      mealId,
      jobId: job.id,
      attempt: job.attempts,
      harness: harness.kind,
      model,
      skill: { path: skill.path, sha256: skill.sha256, text: skill.text },
    });

    let result: PromptRunResult;
    let reply = "";
    try {
      const photos = await Promise.all(
        captures.filter((c) => c.kind === "image").map((c) => agentPhoto(c, this.s.media)),
      );
      const readable = new Set(photos.flatMap((p) => (p.path ? [p.path] : [])));
      const current = meal.currentRevisionId ? repos.revisions.get(meal.currentRevisionId) : null;
      result = await runPrompt({
        harness,
        adapter: adapters[harness.kind],
        cwd: dir,
        systemPrompt: skill.text,
        model,
        mcp: {
          servers: [httpMcpServer(MCP_SERVER_NAME, this.o.mcpUrl, token)],
          allowedTools: [`mcp__${MCP_SERVER_NAME}`, ...WEB_TOOLS],
          credential: { server: MCP_SERVER_NAME, token },
        },
        builtInTools: BUILT_IN_TOOLS,
        isolated: true,
        prompt: (caps) =>
          buildPrompt(
            {
              mealId,
              photos,
              failedTranscripts: failedTranscripts(captures, transcripts),
              currentRevision: current?.number ?? null,
              timeZone: this.s.timeZone,
            },
            caps,
          ),
        permission: analysisPermissions((p) => readable.has(p) || isInside(p, dir)),
        onEvent: (e) => {
          trace.event(e);
          reply = lastReply(reply, e);
        },
        timeouts: this.o.timeouts,
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
      };
    } finally {
      this.s.mcpTokens.revokeRun(runId);
    }

    const saved = repos.revisions.forRun(runId);
    const { runStatus, outcome, error } = judge(result, saved.length > 0, reply, this.now());
    const endedAt = this.now();
    repos.runs.finish(runId, {
      status: runStatus,
      endedAt,
      model: result.model,
      stopReason: result.stopReason,
      usage: result.usage || result.context ? { turn: result.usage, context: result.context } : null,
      error,
      revisionId: saved[0]?.id ?? null,
    });
    trace.write("run.end", {
      status: runStatus,
      stopReason: result.stopReason,
      revisionId: saved[0]?.id ?? null,
      error,
      usage: result.usage,
      context: result.context,
      durationMs: endedAt - startedAt,
    });
    return outcome;
  }

  settled(job: JobOf<"analyse">): void {
    settleMeal(this.s.repos, job, this.now());
  }
}

/** The run's verdict: saved a revision → success, whatever happened after. */
function judge(
  r: PromptRunResult,
  saved: boolean,
  reply: string,
  now: number,
): { runStatus: Exclude<RunStatus, "running">; outcome: JobOutcome; error: string | null } {
  if (saved) {
    return {
      runStatus: "succeeded",
      outcome: { status: "done" },
      error: r.status === "error" ? `after saving the revision: ${r.error}` : null,
    };
  }
  if (r.status === "cancelled") {
    // the server is stopping: run it again at the next start, without spending an attempt
    return {
      runStatus: "cancelled",
      outcome: { status: "reschedule", runAfter: now, reason: "server stopped during the run" },
      error: "cancelled: the server stopped",
    };
  }
  let error: string;
  if (r.status === "error") {
    error = r.error ?? "the run failed";
  } else {
    const said = reply.trim().replace(/\s+/g, " ");
    error = `the agent ended its turn (${r.stopReason}) without calling save_meal_revision${
      said ? `; it said: "${said.length > 300 ? `${said.slice(0, 300)}…` : said}"` : ""
    }`;
  }
  // a missing harness or login won't fix itself within the backoff
  const retryable = r.failure !== "not_installed" && r.failure !== "auth";
  return { runStatus: "failed", outcome: { status: "failed", error, retryable }, error };
}

/** The agent's last message: chunks since the last tool call or thought. */
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
 * The meal's status after its analyse job moved on: a retry or a wait puts an `analysing` meal
 * back to `queued`; the final failure makes it `failed` with the error, unless another analysis
 * of the meal is already queued. A finished job leaves it alone (the revision set it).
 */
export function settleMeal(repos: Repos, job: Job, now = Date.now()): void {
  if (job.type !== "analyse") return;
  const meal = repos.meals.get(job.payload.mealId);
  if (!meal) return;
  if (job.status === "queued" || job.status === "cancelled") {
    if (meal.status === "analysing") repos.meals.setStatus(meal.id, "queued", now);
  } else if (job.status === "failed") {
    if (repos.jobs.hasQueued(dedupeKeys.analyse(meal.id))) {
      if (meal.status === "analysing") repos.meals.setStatus(meal.id, "queued", now);
    } else {
      repos.meals.setStatus(meal.id, "failed", now, job.lastError ?? "the analysis failed");
    }
  }
}
