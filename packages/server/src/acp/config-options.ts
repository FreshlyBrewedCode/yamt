import type * as acp from "./protocol.ts";

/**
 * Generic handling of ACP session config options (`session/new` → `configOptions`,
 * `session/set_config_option` answers the full updated list). Which options exist differs per
 * harness and per model, so nothing here knows a harness: the model is the option in category
 * `model` (else id `model`), the reasoning effort the select in category `thought_level`, else
 * one with a known id. Seen in Nov 2026: claude-agent-acp 0.100.0 and OpenCode 1.18.31 both send
 * `effort` / `thought_level`; other agents have used `thinking`, `reasoning_effort` or `reasoning`.
 */

export const EFFORT_IDS = ["effort", "thinking", "reasoning_effort", "reasoning", "thought_level"];

export type SelectOption = Extract<acp.SessionConfigOption, { type: "select" }>;

export interface FlatChoice {
  value: string;
  name: string;
  description: string | null;
  group: string | null;
}

const isSelect = (o: acp.SessionConfigOption): o is SelectOption => o.type !== "boolean";

/** The option that picks the model: category `model`, else id `model` (selects only). */
export function modelOption(options: readonly acp.SessionConfigOption[]): SelectOption | null {
  const selects = options.filter(isSelect);
  return selects.find((o) => o.category === "model") ?? selects.find((o) => o.id === "model") ?? null;
}

/** The reasoning-effort option: category `thought_level` first, then a known id (selects only). */
export function effortOption(options: readonly acp.SessionConfigOption[]): SelectOption | null {
  const selects = options.filter(isSelect);
  const byCategory = selects.find((o) => o.category === "thought_level");
  if (byCategory) return byCategory;
  for (const id of EFFORT_IDS) {
    const o = selects.find((x) => x.id === id && x.category !== "model");
    if (o) return o;
  }
  return null;
}

/** A select's values, groups flattened. */
export function choices(opt: SelectOption): FlatChoice[] {
  const out: FlatChoice[] = [];
  for (const entry of opt.options) {
    if ("group" in entry) {
      for (const c of entry.options)
        out.push({ value: c.value, name: c.name, description: c.description ?? null, group: entry.name });
    } else {
      out.push({ value: entry.value, name: entry.name, description: entry.description ?? null, group: null });
    }
  }
  return out;
}

export function offers(opt: SelectOption | null, value: string): boolean {
  return !!opt && choices(opt).some((c) => c.value === value);
}

/** One planned `session/set_config_option`, or why a wanted value can't be set. */
export type ConfigStep =
  | { kind: "set"; configId: string; value: string }
  | { kind: "skip"; configId: string | null; value: string; reason: "no option" | "not offered" };

/**
 * What it takes to give the session `value` for its model or effort, given the options the
 * harness reports now; null when it is already current. A value the option doesn't offer is
 * skipped, never sent (some harnesses silently ignore an unlisted id). Callers go model first
 * (the model decides which efforts exist: OpenCode resets the effort on a model switch, Claude
 * Code keeps it) and plan the effort on the options the model switch answered with.
 */
export function configStep(
  options: readonly acp.SessionConfigOption[],
  what: "model" | "effort",
  value: string,
): ConfigStep | null {
  const opt = what === "model" ? modelOption(options) : effortOption(options);
  if (!opt) return { kind: "skip", configId: null, value, reason: "no option" };
  if (opt.currentValue === value) return null;
  if (!offers(opt, value)) return { kind: "skip", configId: opt.id, value, reason: "not offered" };
  return { kind: "set", configId: opt.id, value };
}
