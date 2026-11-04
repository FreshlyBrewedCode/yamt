import { existsSync } from "node:fs";
import {
  type AgentOptionsResponse,
  type AgentResponse,
  type AgentSettingsBody,
  HARNESS_KINDS,
  HARNESS_LABELS,
  type HarnessInfo,
  type HarnessKind,
  type SettingSource,
  type SourcedValue,
} from "@yamt/shared";
import { type HarnessConfig, resolveCommand } from "../acp/adapters/index.ts";
import { type AgentLayer, type AnalysisConfig, DEFAULT_ANALYSIS_MODEL } from "../config.ts";
import type { SettingsRepo } from "../db/repos/settings.ts";
import { HttpError } from "../domain/errors.ts";
import type { AgentDiscovery } from "./discovery.ts";
import { DiscoveryError } from "./discovery.ts";

/** The settings key the app's choice is stored under. */
export const AGENT_SETTINGS_KEY = "agent";

const ENV_VARS = {
  harness: "YAMT_ANALYSIS_HARNESS",
  model: "YAMT_ANALYSIS_MODEL",
  effort: "YAMT_ANALYSIS_EFFORT",
} as const;

export interface EffectiveAgent {
  harness: SourcedValue<HarnessKind>;
  model: SourcedValue<string | null>;
  effort: SourcedValue<string | null>;
}

/**
 * The settings in force: env > the app > config.json > built-in defaults, per value. The harness
 * first; a model or effort from the app or config.json only counts for the harness it was set
 * for (an OpenCode model means nothing to Claude Code), the env's always. Defaults: Claude Code,
 * and for it `claude-opus-5-5`; otherwise null, the harness's own default model and effort.
 */
export function resolveAgent(cfg: AnalysisConfig, app: AgentSettingsBody | null): EffectiveAgent {
  const fileHarness = cfg.file.harness ?? "claude-code";
  const harness: SourcedValue<HarnessKind> = cfg.env.harness
    ? { value: cfg.env.harness, source: "env", envVar: ENV_VARS.harness }
    : app
      ? { value: app.harness, source: "app" }
      : cfg.file.harness
        ? { value: cfg.file.harness, source: "config" }
        : { value: "claude-code", source: "default" };
  const pick = (what: "model" | "effort"): SourcedValue<string | null> => {
    const env = cfg.env[what];
    if (env) return { value: env, source: "env", envVar: ENV_VARS[what] };
    if (app && app.harness === harness.value) {
      const v = app[what];
      if (v !== null) return { value: v, source: "app" };
    }
    const file = (cfg.file as AgentLayer)[what];
    if (file && fileHarness === harness.value) return { value: file, source: "config" };
    const builtIn = what === "model" && harness.value === "claude-code" ? DEFAULT_ANALYSIS_MODEL : null;
    return { value: builtIn, source: "default" };
  };
  return { harness, model: pick("model"), effort: pick("effort") };
}

export interface AgentServiceOptions {
  config: AnalysisConfig;
  repo: SettingsRepo;
  discovery: AgentDiscovery;
  /** Seam for tests: finding a command on PATH. */
  which?: (command: string) => string | null;
}

/** What a run uses: the harness's launch config and the model and effort to ask for. */
export interface RunAgent {
  harness: HarnessConfig;
  model: string | null;
  effort: string | null;
}

/**
 * The Agent setting (#28): the app's choice (stored, never a secret: the custom harness's
 * command stays in config.json), resolved with the env and config.json, the harnesses found on
 * this machine, and what each offers (`AgentDiscovery`). Every analysis run reads it afresh, so a
 * change applies to the next run.
 */
export class AgentService {
  private readonly which: (command: string) => string | null;

  constructor(private readonly o: AgentServiceOptions) {
    this.which = o.which ?? ((c) => Bun.which(c));
  }

  saved(): AgentSettingsBody | null {
    return this.o.repo.get<AgentSettingsBody>(AGENT_SETTINGS_KEY);
  }

  effective(): EffectiveAgent {
    return resolveAgent(this.o.config, this.saved());
  }

  /** The settings for the next run. */
  forRun(): RunAgent {
    const e = this.effective();
    return { harness: this.harnessConfig(e.harness.value), model: e.model.value, effort: e.effort.value };
  }

  harnessConfig(kind: HarnessKind): HarnessConfig {
    const cmd = this.o.config.commands[kind];
    return { kind, command: cmd?.command ?? "", args: cmd?.args ?? [], env: this.o.config.processEnv };
  }

  /** Every harness yamt knows and whether it is here; `custom` only when one is configured. */
  harnesses(): HarnessInfo[] {
    return HARNESS_KINDS.flatMap((kind): HarnessInfo[] => {
      if (kind === "custom" && !this.o.config.commands.custom) return [];
      const reason = this.missing(kind);
      return [{ kind, label: HARNESS_LABELS[kind], available: reason === null, reason }];
    });
  }

  view(): AgentResponse {
    return { ...this.effective(), harnesses: this.harnesses() };
  }

  /** What `kind` offers with `model` selected (null: its default). Throws HttpError. */
  async options(kind: HarnessKind, model: string | null, refresh = false): Promise<AgentOptionsResponse> {
    const info = this.harnesses().find((h) => h.kind === kind);
    if (!info) throw new HttpError(404, `no ${HARNESS_LABELS[kind]} harness is configured`);
    if (!info.available) throw new HttpError(503, info.reason ?? "not available", "not_installed");
    try {
      return await this.o.discovery.options(this.harnessConfig(kind), model, { refresh });
    } catch (e) {
      if (e instanceof DiscoveryError) {
        throw new HttpError(503, `${HARNESS_LABELS[kind]}: ${e.message}`, e.failure);
      }
      throw e;
    }
  }

  /**
   * Saves the app's setting after checking it against what the harness offers: the harness must
   * be here, the model offered, the effort offered for the model that will run. What the env
   * fixes can't be changed here: those values are kept as they were.
   */
  async save(body: AgentSettingsBody): Promise<AgentResponse> {
    const env = this.o.config.env;
    const prev = this.saved();
    const harness = env.harness ?? body.harness;
    const sameHarness = prev?.harness === harness;
    const next: AgentSettingsBody = {
      harness,
      model: env.model ? (sameHarness ? (prev?.model ?? null) : null) : body.model,
      effort: env.effort ? (sameHarness ? (prev?.effort ?? null) : null) : body.effort,
    };
    if (!env.harness) {
      const info = this.harnesses().find((h) => h.kind === harness);
      if (!info) throw new HttpError(400, `no ${HARNESS_LABELS[harness]} harness is configured`);
      if (!info.available) throw new HttpError(400, `${info.label}: ${info.reason}`);
    }
    const label = HARNESS_LABELS[harness];
    if (!env.model && next.model !== null) {
      const opts = await this.options(harness, null);
      if (!opts.models?.choices.some((c) => c.value === next.model))
        throw new HttpError(400, `${label} doesn't offer the model ${next.model}`);
    }
    if (!env.effort && next.effort !== null) {
      const model = resolveAgent(this.o.config, next).model.value;
      const opts = await this.options(harness, model);
      if (!opts.effort)
        throw new HttpError(400, `${label} has no effort setting${model ? ` for ${model}` : ""}`);
      if (!opts.effort.choices.some((c) => c.value === next.effort))
        throw new HttpError(
          400,
          `${label} doesn't offer the effort ${next.effort}${model ? ` for ${model}` : ""}`,
        );
    }
    this.o.repo.set(AGENT_SETTINGS_KEY, next);
    return this.view();
  }

  /** Why a harness can't run here, or null. */
  private missing(kind: HarnessKind): string | null {
    let cmd: { command: string; args: string[] } | null;
    try {
      cmd = resolveCommand(this.harnessConfig(kind));
    } catch {
      return "its ACP adapter isn't installed";
    }
    if (!cmd) return "no command configured";
    const found = cmd.command.includes("/") ? existsSync(cmd.command) : this.which(cmd.command) !== null;
    return found ? null : `${cmd.command} isn't installed on the server`;
  }
}

/** For the startup line: "claude-code, model claude-opus-5-5 (default), effort: the harness's". */
export function describeAgent(e: EffectiveAgent): string {
  const src = (s: SettingSource) => (s === "app" ? "set in the app" : s === "config" ? "config.json" : s);
  return [
    `${e.harness.value} (${src(e.harness.source)})`,
    `model ${e.model.value ?? "the harness's default"}${e.model.value ? ` (${src(e.model.source)})` : ""}`,
    `effort ${e.effort.value ?? "the harness's default"}${e.effort.value ? ` (${src(e.effort.source)})` : ""}`,
  ].join(", ");
}
