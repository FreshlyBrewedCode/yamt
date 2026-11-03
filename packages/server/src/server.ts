import { MAX_UPLOAD_BYTES } from "@yamt/shared";
import { Hono } from "hono";
import type { AuthMode } from "./auth/identity.ts";
import { ensureDataDir } from "./config.ts";
import { type Db, openDb } from "./db/index.ts";
import { createApi } from "./http/api.ts";
import { staticHandler, WEB_DIST } from "./http/static.ts";
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
}

export interface AppServer {
  db: Db;
  services: Services;
  port: number;
  /** http://localhost:<port>/ */
  localUrl: string;
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
  // one process owns the queue: whatever an earlier one left running was interrupted
  services.repos.jobs.releaseInterrupted();

  const app = new Hono();
  app.route("/api", createApi({ db, auth: opts.auth, services }));
  const serveStatic = opts.webDist === null ? null : staticHandler(opts.webDist ?? WEB_DIST);

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname ?? "127.0.0.1",
    // multipart overhead on top of the largest file (long voice memos)
    maxRequestBodySize: MAX_UPLOAD_BYTES + 1024 * 1024,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api" || pathname.startsWith("/api/")) return app.fetch(req);
      // /mcp (epic #2, #7) mounts here, behind requireBearer (auth/bearer.ts), not the identity check
      if (serveStatic) return serveStatic(req);
      return new Response("not found", { status: 404 });
    },
  });
  const port = server.port!;

  return {
    db,
    services,
    port,
    localUrl: `http://localhost:${port}/`,
    async stop() {
      await server.stop(true);
      db.close();
    },
  };
}
