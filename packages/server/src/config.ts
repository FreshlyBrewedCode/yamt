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
    /** Speech-to-text models (the Hugging Face cache of the STT process), downloaded on first use. */
    models: join(dataDir, "models"),
  };
}

/**
 * Create the data dir and its subdirs private to the user (0700), tightening them if they exist
 * with a looser mode: they hold every meal, photo and voice memo.
 */
export function ensureDataDir(dataDir: string): ReturnType<typeof dataPaths> {
  const paths = dataPaths(dataDir);
  for (const dir of [dataDir, paths.media, paths.runs, paths.models]) {
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

const TranscriptionConfigFile = z
  .object({
    /** The STT process's command line (default: services/stt/run.sh transcribe). */
    command: z.string().trim().min(1).optional(),
    args: z.array(z.string()).optional(),
    /** faster-whisper model name, Hugging Face repo id or local CTranslate2 dir. */
    model: z.string().trim().min(1).optional(),
    /** CTranslate2 compute type: int8 (default), int8_float32, float32, … */
    computeType: z.string().trim().min(1).optional(),
    /** CPU threads for the model (default 4, of the VM's 6). */
    threads: z.number().int().min(1).max(64).optional(),
    beamSize: z.number().int().min(1).max(10).optional(),
    /** Silero VAD before decoding: drops silence, where Whisper hallucinates (default on). */
    vad: z.boolean().optional(),
    language: z.string().trim().min(2).max(10).optional(),
    /** Vocabulary hint for Whisper, e.g. "Haferflocken, Skyr, Esslöffel". */
    initialPrompt: z.string().trim().min(1).max(1000).optional(),
    /** Path to the ffmpeg binary (default: PATH, else linked from nixpkgs). */
    ffmpeg: z.string().trim().min(1).optional(),
    /** Where models are downloaded (default <data>/models). */
    modelsDir: z.string().trim().min(1).optional(),
  })
  .strict();

/** `<data>/config.json`. Every key is optional; env vars override the file. */
export const AppConfigFile = z
  .object({
    /** The analysis agent (#8); env YAMT_ANALYSIS_HARNESS, YAMT_ANALYSIS_COMMAND, YAMT_ANALYSIS_MODEL. */
    analysis: AnalysisConfigFile.optional(),
    /** Speech-to-text of voice memos (#9); env YAMT_STT_* and YAMT_FFMPEG, see `transcriptionConfig`. */
    transcription: TranscriptionConfigFile.optional(),
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

/** What the STT process is asked to do (the request's `settings`, see services/stt). */
export interface SttSettings {
  model: string;
  computeType: string;
  threads: number;
  beamSize: number;
  vad: boolean;
  language: string;
  initialPrompt: string | null;
}

/** The speech-to-text setup: spike #4's pick, faster-whisper large-v3-turbo int8 on the CPU, `de`. */
export interface TranscriptionConfig {
  /** The STT process's command line; it reads a batch request on stdin. */
  command: string[];
  /** An explicit ffmpeg; null: found on PATH or linked from nixpkgs (`transcription/tools.ts`). */
  ffmpeg: string | null;
  /** Null: `<data>/models`. */
  modelsDir: string | null;
  settings: SttSettings;
}

export const DEFAULT_STT_SETTINGS: SttSettings = {
  model: "large-v3-turbo",
  computeType: "int8",
  threads: 4,
  beamSize: 1,
  vad: true,
  language: "de",
  initialPrompt: null,
};

/** services/stt/run.sh in this checkout. */
export const STT_RUNNER = resolve(import.meta.dir, "../../../services/stt/run.sh");

export interface AppConfig {
  login: string | null;
  analysis: AnalysisConfig;
  transcription: TranscriptionConfig;
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
  return {
    login,
    fdcApiKey,
    analysis: analysisConfig(file.analysis ?? {}, env),
    transcription: transcriptionConfig(file.transcription ?? {}, env),
  };
}

/**
 * Speech-to-text from config.json's `transcription` and the env, which wins: YAMT_STT_COMMAND (a
 * command line, split on spaces; replaces `command` and `args`), YAMT_STT_MODEL,
 * YAMT_STT_COMPUTE_TYPE, YAMT_STT_THREADS, YAMT_STT_BEAM_SIZE, YAMT_STT_VAD (0/1),
 * YAMT_STT_LANGUAGE, YAMT_STT_INITIAL_PROMPT, YAMT_STT_MODELS_DIR, YAMT_FFMPEG.
 */
export function transcriptionConfig(
  file: z.infer<typeof TranscriptionConfigFile>,
  env: Env = process.env,
): TranscriptionConfig {
  const e = (name: string) => env[name]?.trim() || undefined;
  const int = (name: string, min: number, max: number): number | undefined => {
    const v = e(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${name}: expected a whole number from ${min} to ${max}, got ${v}`);
    }
    return n;
  };
  const vadEnv = e("YAMT_STT_VAD");
  if (vadEnv !== undefined && !["0", "1", "true", "false"].includes(vadEnv)) {
    throw new Error(`YAMT_STT_VAD: expected 0 or 1, got ${vadEnv}`);
  }
  const commandLine = e("YAMT_STT_COMMAND")?.split(/\s+/);
  const command =
    commandLine ?? (file.command ? [file.command, ...(file.args ?? [])] : [STT_RUNNER, "transcribe"]);
  const d = DEFAULT_STT_SETTINGS;
  return {
    command,
    ffmpeg: e("YAMT_FFMPEG") ?? file.ffmpeg ?? null,
    modelsDir: e("YAMT_STT_MODELS_DIR") ?? file.modelsDir ?? null,
    settings: {
      model: e("YAMT_STT_MODEL") ?? file.model ?? d.model,
      computeType: e("YAMT_STT_COMPUTE_TYPE") ?? file.computeType ?? d.computeType,
      threads: int("YAMT_STT_THREADS", 1, 64) ?? file.threads ?? d.threads,
      beamSize: int("YAMT_STT_BEAM_SIZE", 1, 10) ?? file.beamSize ?? d.beamSize,
      vad: vadEnv !== undefined ? vadEnv === "1" || vadEnv === "true" : (file.vad ?? d.vad),
      language: e("YAMT_STT_LANGUAGE") ?? file.language ?? d.language,
      initialPrompt: e("YAMT_STT_INITIAL_PROMPT") ?? file.initialPrompt ?? d.initialPrompt,
    },
  };
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
