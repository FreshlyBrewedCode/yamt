import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { HarnessConfig } from "./acp/adapters/index.ts";

export const VERSION = "0.1.0";

/** Loopback HTTP port. 7880 (vibe-center) and 7899 (its e2e) are taken on the host. */
export const DEFAULT_PORT = 7890;
/** Tailnet HTTPS port for `tailscale serve`; 443, 8443 and 7443 are served by other apps. */
export const DEFAULT_HTTPS_PORT = 7444;

type Env = Record<string, string | undefined>;

/** Where everything personal lives. `--data-dir` beats `YAMT_DATA_DIR` beats `~/.yamt`. */
export function resolveDataDir(flag?: string, env: Env = process.env): string {
  const dir = flag ?? env.YAMT_DATA_DIR ?? join(homedir(), ".yamt");
  return resolve(expandHome(dir));
}

export function dataPaths(dataDir: string) {
  return {
    db: join(dataDir, "yamt.db"),
    /** Raw captures (audio, photos), immutable once written. */
    media: join(dataDir, "media"),
    /** One dir per agent run: the ACP trace and scratch files. */
    runs: join(dataDir, "runs"),
    /** Optional local settings (`AppConfig`); never in the repo. */
    config: join(dataDir, "config.json"),
    /** The long-lived MCP token for interactive sessions (0600), see `yamt mcp-token`. */
    mcpToken: join(dataDir, "mcp-token"),
  };
}

/**
 * Create the data dir and its subdirs private to the user (0700), tightening them if they exist
 * with a looser mode: they hold every meal, photo and voice memo.
 */
export function ensureDataDir(dataDir: string): ReturnType<typeof dataPaths> {
  const paths = dataPaths(dataDir);
  for (const dir of [dataDir, paths.media, paths.runs]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  return paths;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** The model the analysis asks for unless configured otherwise. */
export const DEFAULT_ANALYSIS_MODEL = "claude-opus-5-5";

const AnalysisConfigFile = z
  .object({
    /** `claude-code` (claude-agent-acp, the default) or `custom` (any ACP agent: give `command`). */
    harness: z.enum(["claude-code", "custom"]).optional(),
    /** Overrides the preset's command line (custom: required). */
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    model: z.string().trim().min(1).optional(),
  })
  .strict();

/** `<data>/config.json`. Every key is optional; env vars override the file. */
export const AppConfigFile = z
  .object({
    /** The analysis agent (#8); env YAMT_ANALYSIS_HARNESS, YAMT_ANALYSIS_COMMAND, YAMT_ANALYSIS_MODEL. */
    analysis: AnalysisConfigFile.optional(),
    /** The Tailscale login allowed in, as `tailscale serve` reports it (e.g. `alice@github`). */
    login: z.string().trim().min(1).optional(),
    /** USDA FoodData Central API key (https://fdc.nal.usda.gov/api-key-signup); env FDC_API_KEY wins. */
    fdcApiKey: z.string().trim().min(1).optional(),
  })
  .strict();

/** Which agent analyses meals, and with which model. */
export interface AnalysisConfig {
  harness: HarnessConfig;
  model: string;
}

export interface AppConfig {
  login: string | null;
  analysis: AnalysisConfig;
  /** Null: FDC is reported as unavailable, searches use history and Open Food Facts. */
  fdcApiKey: string | null;
}

export function loadConfig(dataDir: string, env: Env = process.env): AppConfig {
  const path = dataPaths(dataDir).config;
  let file: z.infer<typeof AppConfigFile> = {};
  if (existsSync(path)) {
    const parsed = AppConfigFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) throw new Error(`${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    file = parsed.data;
  }
  const login = env.YAMT_LOGIN?.trim() || file.login || null;
  const fdcApiKey = env.FDC_API_KEY?.trim() || file.fdcApiKey || null;
  return { login, fdcApiKey, analysis: analysisConfig(file.analysis ?? {}, env) };
}

/**
 * The analysis harness from config.json's `analysis` and the env: YAMT_ANALYSIS_HARNESS
 * (`claude-code` | `custom`), YAMT_ANALYSIS_COMMAND (a command line, split on spaces; replaces
 * `command` and `args`), YAMT_ANALYSIS_MODEL.
 */
export function analysisConfig(
  file: z.infer<typeof AnalysisConfigFile>,
  env: Env = process.env,
): AnalysisConfig {
  const kindEnv = env.YAMT_ANALYSIS_HARNESS?.trim();
  if (kindEnv && kindEnv !== "claude-code" && kindEnv !== "custom") {
    throw new Error(`YAMT_ANALYSIS_HARNESS: expected claude-code or custom, got ${kindEnv}`);
  }
  const kind = (kindEnv as HarnessConfig["kind"] | undefined) || file.harness || "claude-code";
  const commandLine = env.YAMT_ANALYSIS_COMMAND?.trim().split(/\s+/).filter(Boolean);
  const command = commandLine?.[0] ?? file.command ?? "";
  const args = commandLine ? commandLine.slice(1) : (file.args ?? []);
  if (kind === "custom" && !command) {
    throw new Error(
      'analysis: the custom harness needs a command (config.json "analysis.command" or YAMT_ANALYSIS_COMMAND)',
    );
  }
  return {
    harness: { kind, command, args, env: file.env ?? {} },
    model: env.YAMT_ANALYSIS_MODEL?.trim() || file.model || DEFAULT_ANALYSIS_MODEL,
  };
}
