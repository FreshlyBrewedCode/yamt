import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

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

/** `<data>/config.json`. Every key is optional; env vars override the file. */
export const AppConfigFile = z
  .object({
    /** The Tailscale login allowed in, as `tailscale serve` reports it (e.g. `alice@github`). */
    login: z.string().trim().min(1).optional(),
    /** USDA FoodData Central API key (https://fdc.nal.usda.gov/api-key-signup); env FDC_API_KEY wins. */
    fdcApiKey: z.string().trim().min(1).optional(),
  })
  .strict();

export interface AppConfig {
  login: string | null;
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
  return { login, fdcApiKey };
}
