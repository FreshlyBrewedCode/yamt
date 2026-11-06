#!/usr/bin/env bun
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { describeAgent } from "./agent/settings.ts";
import type { AuthMode } from "./auth/identity.ts";
import { isBuildStale, type WebBuildSources, writeStamp } from "./build-stamp.ts";
import {
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_HTTPS_PORT,
  DEFAULT_PORT,
  dataPaths,
  ensureDataDir,
  loadConfig,
  resolveDataDir,
} from "./config.ts";
import { WEB_DIST } from "./http/static.ts";
import { McpTokens } from "./mcp/tokens.ts";
import { createServer } from "./server.ts";
import { type TailscaleServe, tailscaleServe } from "./tailscale.ts";
import { resolveFfmpeg } from "./transcription/tools.ts";

const HELP = `Usage: yamt <command> [options]

Commands:
  start       Start the server and publish it on the tailnet
  mcp-token   Print the MCP token for interactive sessions (created on first use):
              export YAMT_MCP_TOKEN=$(bun packages/server/src/cli.ts mcp-token)
              --rotate makes a new one; the old one stops working at once

Options:
  --data-dir <dir>     Data directory (default ~/.yamt, env YAMT_DATA_DIR)
  --port <n>           Local HTTP port, loopback only (default ${DEFAULT_PORT}, env YAMT_PORT)
  --https-port <n>     Tailnet HTTPS port for \`tailscale serve\` (default ${DEFAULT_HTTPS_PORT})
  --local              Don't publish on the tailnet; localhost only
  --no-auth            Skip the Tailscale identity check (only with --local; for development)
  --dev                Serve the web app from Vite with HMR (on port+1)
  --no-build           Don't check for or rebuild a stale web build
  --no-worker          Don't run queued jobs (analysis, planning, transcription); they wait for the next start

Auth: requests must come through \`tailscale serve\` from the configured Tailscale login
(env YAMT_LOGIN, or "login" in <data-dir>/config.json). /mcp takes bearer tokens instead.

Analysis: Claude Code via claude-agent-acp with ${DEFAULT_ANALYSIS_MODEL}, logged in with the
\`claude\` CLI. Pick the harness (Claude Code, OpenCode), model and effort in the app (Settings →
Agent). "analysis" in <data-dir>/config.json ({"harness": "claude-code" | "opencode" | "custom",
"command": …, "args": […], "env": {…}, "model": …, "effort": …}) sets them under the app's choice;
env YAMT_ANALYSIS_HARNESS / YAMT_ANALYSIS_MODEL / YAMT_ANALYSIS_EFFORT fix them over it, and
YAMT_ANALYSIS_COMMAND replaces the command line (a custom ACP agent's only from config or env).

Planning: rounds of meal suggestions run on the same harnesses, by default Claude Code with
claude-opus-5-5 at effort medium. "planning" in <data-dir>/config.json ({"harness", "model",
"effort"}) sets them under the app's choice; env YAMT_PLANNING_HARNESS / YAMT_PLANNING_MODEL /
YAMT_PLANNING_EFFORT fix them over it. Command lines are the analysis's.

Transcription: voice memos are transcribed on this machine's CPU with faster-whisper
large-v3-turbo (int8, German) by services/stt/run.sh, one short-lived process per batch; the
model (~1.6 GB) is downloaded into <data-dir>/models on first use. Needs ffmpeg (PATH, else
linked from nixpkgs) and uv (PATH, else nixpkgs). "transcription" in <data-dir>/config.json
({"model", "computeType", "threads", "beamSize", "vad", "language", "initialPrompt", "ffmpeg",
"modelsDir", "command", "args"}) or env YAMT_STT_* / YAMT_FFMPEG tune it.

Notifications: Web Push to the home-screen app (Settings → Turn on notifications). The VAPID
keys are made at the first start (<data-dir>/vapid.json); "push": {"subject": "mailto:…"} in
<data-dir>/config.json or env YAMT_PUSH_SUBJECT names a contact for push services.

Food data: USDA FoodData Central needs an API key (env FDC_API_KEY, or "fdcApiKey" in
<data-dir>/config.json); without one, searches use history and Open Food Facts only.
`;

const WEB_DIR = join(import.meta.dir, "../../web");
const SHARED_DIR = join(import.meta.dir, "../../shared");
const ROOT_DIR = join(import.meta.dir, "../../..");

/** What feeds the web build, so a stale `dist` can be detected and rebuilt before serving. */
const WEB_BUILD_SOURCES: WebBuildSources = {
  webSrc: join(WEB_DIR, "src"),
  webIndexHtml: join(WEB_DIR, "index.html"),
  webPublic: join(WEB_DIR, "public"),
  webViteConfig: join(WEB_DIR, "vite.config.ts"),
  webServiceWorker: join(WEB_DIR, "sw.js"),
  webPackageJson: join(WEB_DIR, "package.json"),
  sharedSrc: join(SHARED_DIR, "src"),
  sharedPackageJson: join(SHARED_DIR, "package.json"),
  rootPackageJson: join(ROOT_DIR, "package.json"),
  lockfile: join(ROOT_DIR, "bun.lock"),
};

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      port: { type: "string" },
      "https-port": { type: "string" },
      local: { type: "boolean", default: false },
      "no-auth": { type: "boolean", default: false },
      dev: { type: "boolean", default: false },
      "no-build": { type: "boolean", default: false },
      "no-worker": { type: "boolean", default: false },
      rotate: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  if (command === "mcp-token") {
    // only the token on stdout, so `export YAMT_MCP_TOKEN=$(yamt mcp-token)` works
    const tokens = new McpTokens(ensureDataDir(resolveDataDir(values["data-dir"])).mcpToken);
    console.log(values.rotate ? tokens.rotateInteractive() : tokens.interactiveToken());
    return 0;
  }
  if (command !== "start") {
    console.error(`unknown command: ${command}\n\n${HELP}`);
    return 1;
  }

  const dataDir = resolveDataDir(values["data-dir"]);
  if (values["no-auth"] && !values.local) {
    throw new Error("--no-auth only works with --local: the tailnet URL always checks the identity");
  }
  const config = loadConfig(dataDir);
  const auth: AuthMode = values["no-auth"] ? { kind: "off" } : { kind: "tailnet", login: config.login };
  if (auth.kind === "tailnet" && !auth.login) {
    const how = `set YAMT_LOGIN or "login" in ${dataPaths(dataDir).config} to your Tailscale login`;
    if (!values.local) throw new Error(`no login configured: ${how} (e.g. alice@github)`);
    console.warn(`No login configured, every API request will be refused: ${how}, or use --no-auth.`);
  }
  const port = Number(values.port ?? process.env.YAMT_PORT ?? DEFAULT_PORT);
  const httpsPort = Number(values["https-port"] ?? DEFAULT_HTTPS_PORT);

  const cleanups: (() => unknown)[] = [];
  const cleanup = async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.error(e);
      }
    }
  };

  try {
    if (!values.dev && !values["no-build"] && isBuildStale(WEB_DIST, WEB_BUILD_SOURCES)) {
      console.log(
        existsSync(join(WEB_DIST, "index.html"))
          ? "web app changed since last build, rebuilding…"
          : "Building the web app (first start)…",
      );
      const build = Bun.spawnSync(["bun", "run", "build"], {
        cwd: WEB_DIR,
        stdout: "inherit",
        stderr: "inherit",
      });
      if (build.exitCode !== 0) throw new Error("web build failed");
      writeStamp(WEB_DIST, WEB_BUILD_SOURCES);
    }

    const app = createServer({
      dataDir,
      port,
      webDist: values.dev ? null : WEB_DIST,
      auth,
      fdcApiKey: config.fdcApiKey,
      worker: !values["no-worker"],
      analysis: { config: config.analysis },
      planning: { config: config.planning },
      transcription: { config: config.transcription },
      push: { subject: config.push.subject },
    });
    cleanups.push(() => app.stop());

    // In dev mode Vite serves the SPA (with HMR) and proxies /api to the app port.
    let webPort = app.port;
    if (values.dev) {
      webPort = app.port + 1;
      const vite = await startVite(webPort, app.port);
      cleanups.push(() => stopChild(vite));
    }

    let ts: TailscaleServe | null = null;
    if (!values.local) {
      try {
        ts = await tailscaleServe(httpsPort, webPort);
        cleanups.push(() => ts?.stop());
      } catch (e) {
        console.warn(`Not published on the tailnet (${(e as Error).message}). Use --local to skip this.`);
      }
    }

    console.log(`\nyamt is running${values.dev ? " (dev)" : ""}. Data: ${dataDir}`);
    if (ts) console.log(`  Tailnet:  ${ts.url}`);
    console.log(`  Local:    http://localhost:${webPort}/${auth.kind === "off" ? "  (auth off)" : ""}`);
    console.log(`  MCP:      ${app.mcpUrl}  (bearer token: \`yamt mcp-token\`)`);
    console.log(
      values["no-worker"]
        ? "  Analysis: off (--no-worker)"
        : `  Analysis: ${describeAgent(app.services.agent.effective())}; change it in Settings → Agent`,
    );
    if (!values["no-worker"])
      console.log(`  Planning: ${describeAgent(app.services.agent.planningEffective())}`);
    if (app.transcription) {
      // found now rather than at the first memo: a missing ffmpeg fails transcripts (not analyses)
      const ffmpeg = await resolveFfmpeg({ configured: config.transcription.ffmpeg }).then(
        (path) => ({ ok: true as const, path }),
        (e: Error) => ({ ok: false as const, error: e.message }),
      );
      console.log(`  Speech:   ${app.transcription}`);
      if (!ffmpeg.ok)
        console.warn(`  Speech:   NOT AVAILABLE, voice memos will fail to transcribe: ${ffmpeg.error}`);
    }
    if (!config.fdcApiKey) console.log("  Food data: no FDC_API_KEY, USDA FoodData Central is off");
    console.log("Ctrl+C to stop.\n");
  } catch (e) {
    await cleanup();
    throw e;
  }

  return new Promise<number>((resolve) => {
    let stopping = false;
    const stop = (code: number) => {
      if (stopping) return;
      stopping = true;
      console.log("\nStopping…");
      void cleanup().then(() => resolve(code));
    };
    process.on("SIGINT", () => stop(0));
    process.on("SIGTERM", () => stop(0));
    process.on("SIGHUP", () => stop(0));
    // A bug that throws in a timer or callback: take the `tailscale serve` entry down with us.
    process.on("uncaughtException", (e) => {
      console.error("yamt: uncaught exception, shutting down", e);
      stop(1);
    });
    process.on("unhandledRejection", (e) => {
      console.error("yamt: unhandled rejection", e);
    });
  });
}

async function startVite(port: number, apiPort: number): Promise<ChildProcess> {
  const child = spawn("bun", ["x", "vite", "--port", String(port), "--strictPort"], {
    cwd: WEB_DIR,
    env: { ...process.env, YAMT_API_PORT: String(apiPort) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("vite exited");
    const ok = await fetch(`http://127.0.0.1:${port}/`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return child;
    await Bun.sleep(100);
  }
  child.kill();
  throw new Error("vite did not start within 10 s");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await Promise.race([exited, Bun.sleep(3000).then(() => child.kill("SIGKILL"))]);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`yamt: ${(e as Error).message}`);
    process.exit(1);
  },
);
