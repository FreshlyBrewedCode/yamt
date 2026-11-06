import { z } from "zod";

/**
 * Agent settings (#28): which harness runs yamt's agent work (today: meal analysis), which model
 * and which reasoning effort. The options come from the harness itself (ACP `configOptions`,
 * read by starting it once, without a prompt), never from a list in the code.
 *
 * Precedence per value: env (`YAMT_ANALYSIS_HARNESS`, `_MODEL`, `_EFFORT`) > the app's setting
 * (stored in the database) > `config.json` `analysis` > built-in defaults (Claude Code,
 * `claude-opus-5-5`, the harness's own effort). A model or effort belongs to its harness: one set
 * for another harness doesn't carry over.
 */

export const agentPaths = {
  /** GET the effective settings with their sources and the harnesses (`AgentResponse`); PUT `AgentSettingsBody`. */
  agent: "/api/agent",
  /** GET `?harness=…[&model=…][&refresh=1]`: the harness's models and efforts (`AgentOptionsResponse`). */
  options: "/api/agent/options",
  /** PUT the planning agent (#46), same body and checks as `agent`; it's part of `AgentResponse.planning`. */
  planningAgent: "/api/agent/planning",
} as const;

export const HARNESS_KINDS = ["claude-code", "opencode", "custom"] as const;
export const HarnessKind = z.enum(HARNESS_KINDS);
export type HarnessKind = z.infer<typeof HarnessKind>;

export const HARNESS_LABELS: Record<HarnessKind, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  custom: "Custom agent",
};

/** Where an effective value comes from. */
export type SettingSource = "env" | "app" | "config" | "default";

export interface SourcedValue<T> {
  value: T;
  source: SettingSource;
  /** The env var that fixes it (source `env`). */
  envVar?: string;
}

export interface HarnessInfo {
  kind: HarnessKind;
  label: string;
  /** Found on the server (installed, or configured for `custom`). */
  available: boolean;
  /** Why not, when it isn't. */
  reason: string | null;
}

export interface AgentPart {
  harness: SourcedValue<HarnessKind>;
  /** Null: the harness's own default model. */
  model: SourcedValue<string | null>;
  /** Null: the harness's own default effort. */
  effort: SourcedValue<string | null>;
  /** Every harness yamt knows; `custom` only when config.json or the env configure one. */
  harnesses: HarnessInfo[];
}

/**
 * `GET /api/agent`: the analysis agent, and `planning` (#46) the planning agent (#45), the same
 * shape, resolved and saved separately (`PUT /api/agent` and `PUT /api/agent/planning`).
 */
export interface AgentResponse extends AgentPart {
  planning: AgentPart;
}

const OptionValue = z.string().trim().min(1).max(200);

/**
 * `PUT /api/agent`: the app's setting as a whole. Null model or effort: not set here (the next
 * layer applies). Model and effort are checked against what the harness offers; values the env
 * fixes are kept as they were.
 */
export const AgentSettingsBody = z
  .object({ harness: HarnessKind, model: OptionValue.nullable(), effort: OptionValue.nullable() })
  .strict();
export type AgentSettingsBody = z.infer<typeof AgentSettingsBody>;

export interface AgentChoice {
  value: string;
  name: string;
  description: string | null;
  /** The harness's group, or the provider of a `provider/model` id. */
  group: string | null;
}

/** One select config option of the harness, flattened. */
export interface AgentOption {
  /** The ACP config option id (`model`, `effort`, `thinking`, …). */
  id: string;
  name: string;
  /** What the harness has selected (its default, or the model asked for). */
  current: string;
  choices: AgentChoice[];
}

/** `GET /api/agent/options`. */
export interface AgentOptionsResponse {
  harness: HarnessKind;
  /** The model the efforts were read for (selected first), null: the harness's default. */
  model: string | null;
  agent: { name: string; version: string | null } | null;
  /** Null: the harness has no model option. */
  models: AgentOption | null;
  /** Null: no effort option for this model. */
  effort: AgentOption | null;
  discoveredAt: number;
}

/** A harness that couldn't be asked: `GET /api/agent/options` answers 503 with one as `hint`. */
export type DiscoveryFailure = "not_installed" | "auth" | "error";

/** "Opus 5.5", the id when the harness doesn't list it. */
export function choiceLabel(option: AgentOption | null | undefined, value: string): string {
  return option?.choices.find((c) => c.value === value)?.name ?? value;
}
