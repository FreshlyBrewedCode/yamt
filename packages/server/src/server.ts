import { MAX_UPLOAD_BYTES } from "@yamt/shared";
import { Hono } from "hono";
import type { RunTimeouts } from "./acp/run.ts";
import { AnalysisJob, settleMeal } from "./analysis/job.ts";
import type { AuthMode } from "./auth/identity.ts";
import { type AnalysisConfig, analysisConfig, ensureDataDir } from "./config.ts";
import { type Db, openDb } from "./db/index.ts";
import { createApi } from "./http/api.ts";
import { staticHandler, WEB_DIST } from "./http/static.ts";
import { JobWorker } from "./jobs/worker.ts";
import { createMcpApp, MCP_PATH } from "./mcp/endpoint.ts";
import type { Fetch } from "./nutrition/http.ts";
import { createServices, type Services } from "./services.ts";

export interface ServerOptions {
  dataDir: string;
  /** 0 picks a free port. */
  port: number;
  /** Always loopback: remote devices come in through `tailscale serve`. */
  hostname?: string;
  /** Serve the built SPA from here; null when Vite serves it (dev mode). */
  webDist?: string | null;
  auth: AuthMode;
  /** Override for tests: the HEIC → JPEG conversion. */
  heicToJpeg?: (heic: Uint8Array) => Promise<Uint8Array>;
  /** USDA FoodData Central key; null or absent: FDC is reported unavailable. */
  fdcApiKey?: string | null;
  /** Override for tests: outbound HTTP (food databases, recipe pages). */
  fetch?: Fetch;
  /** Override for tests: the zone days are reckoned in (default: the server's). */
  timeZone?: string;
  /**
   * Run the job worker (meal analysis; transcription with #9). Off unless asked for, so tests and
   * tools that only need the API never spawn an agent; `yamt start` turns it on.
   */
  worker?: boolean | { pollMs?: number };
  /** The analysis agent; default: `analysisConfig({})` (Claude Code, the default model). */
  analysis?: {
    config?: AnalysisConfig;
    timeouts?: Partial<RunTimeouts>;
    transcriptWaitMs?: number;
    skillPath?: string;
  };
}

export interface AppServer {
  db: Db;
  services: Services;
  port: number;
  /** http://localhost:<port>/ */
  localUrl: string;
  /** http://127.0.0.1:<port>/mcp, what `.mcp.json` and agent runs point at. */
  mcpUrl: string;
  /** The job worker, when enabled (#9 registers its transcribe handler on it). */
  worker: JobWorker | null;
  stop(): Promise<void>;
}

/** Composition root: data dir, DB, HTTP API and the SPA on one loopback port. */
export function createServer(opts: ServerOptions): AppServer {
  const paths = ensureDataDir(opts.dataDir);
  const db = openDb(paths.db);
  const services = createServices({
    dataDir: opts.dataDir,
    db,
    heicToJpeg: opts.heicToJpeg,
    fdcApiKey: opts.fdcApiKey,
    fetch: opts.fetch,
    timeZone: opts.timeZone,
  });
  // one process owns the queue: whatever an earlier one left running was interrupted (a failed
  // attempt), and so were its runs; their meals go back to queued, or failed after the last try
  const released = services.repos.jobs.releaseInterrupted();
  services.repos.runs.failInterrupted();
  for (const job of released) settleMeal(services.repos, job);
  // the interactive MCP token exists from the first start on (`yamt mcp-token` prints it)
  services.mcpTokens.interactiveToken();

  const app = new Hono();
  app.route("/api", createApi({ db, auth: opts.auth, services }));
  // bearer tokens, never the tailnet identity: agent runs and interactive sessions on this machine
  app.route(MCP_PATH, createMcpApp(services));
  const serveStatic = opts.webDist === null ? null : staticHandler(opts.webDist ?? WEB_DIST);

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname ?? "127.0.0.1",
    // multipart overhead on top of the largest file (long voice memos)
    maxRequestBodySize: MAX_UPLOAD_BYTES + 1024 * 1024,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api" || pathname.startsWith("/api/")) return app.fetch(req);
      if (pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`)) return app.fetch(req);
      if (serveStatic) return serveStatic(req);
      return new Response("not found", { status: 404 });
    },
  });
  const port = server.port!;
  const mcpUrl = `http://127.0.0.1:${port}${MCP_PATH}`;

  let worker: JobWorker | null = null;
  if (opts.worker) {
    const a = opts.analysis ?? {};
    worker = new JobWorker(services.repos.jobs, typeof opts.worker === "object" ? opts.worker : {});
    worker.register(
      new AnalysisJob(services, {
        config: a.config ?? analysisConfig({}),
        mcpUrl,
        timeouts: a.timeouts,
        transcriptWaitMs: a.transcriptWaitMs,
        skillPath: a.skillPath,
      }),
    );
    const w = worker;
    services.queue.wake = () => w.wake();
    w.start();
  }

  return {
    db,
    services,
    port,
    localUrl: `http://localhost:${port}/`,
    mcpUrl,
    worker,
    async stop() {
      // a running analysis is cancelled and queued again (no attempt spent) before the API goes
      await worker?.stop();
      await server.stop(true);
      db.close();
    },
  };
}
