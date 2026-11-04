import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessAdapter } from "./types.ts";

/** The instructions file OpenCode reads the system prompt from, in the session's cwd (the run dir). */
export const OPENCODE_INSTRUCTIONS = "opencode-instructions.md";

/**
 * What an OpenCode job may do, as OpenCode permission rules (the last matching rule wins). Its
 * default allows everything, shell and edits included, so a background job narrows it: the yamt
 * tools (`yamt_*`) and web fetch/search run; shell, edits, sub-agents, skills and questions are
 * denied; reads, searches and anything else ask, and the job's permission policy answers over ACP
 * (photos and the run dir only).
 */
export const OPENCODE_PERMISSIONS: Record<string, "allow" | "ask" | "deny"> = {
  "*": "ask",
  "yamt_*": "allow",
  webfetch: "allow",
  websearch: "allow",
  todowrite: "allow",
  bash: "deny",
  edit: "deny",
  task: "deny",
  skill: "deny",
  lsp: "deny",
  question: "deny",
  doom_loop: "deny",
};

/**
 * OpenCode (`opencode acp`), ported from vibe-center. It has no ACP system prompt, so the skill
 * goes in through OpenCode's own config: an `instructions` file (appended to OpenCode's prompt,
 * like an AGENTS.md) passed inline with OPENCODE_CONFIG_CONTENT, which OpenCode merges over the
 * user's config (providers and logins stay). Model and effort are ordinary config options
 * (`model`, and `effort` in category `thought_level`, per model; switching the model resets the
 * effort to the new model's default, so the run sets the model first).
 *
 * Quirks the run handles: on provider errors OpenCode can hang without a word (the idle timeout
 * cancels the turn), and it answers `session/cancel` with `end_turn` rather than `cancelled` (the
 * run trusts its own cancel); a harness that ignores the cancel is killed after the grace period.
 * Its login is its own (`opencode auth login`); which models it lists depends on it.
 */
export const opencodeAdapter: HarnessAdapter = {
  kind: "opencode",
  modelViaMeta: false,

  defaultLaunch: () => ({ command: "opencode", args: ["acp"] }),

  async prepareProcess({ cwd, systemPrompt }) {
    const config: Record<string, unknown> = { permission: OPENCODE_PERMISSIONS };
    if (systemPrompt.trim()) {
      const file = join(cwd, OPENCODE_INSTRUCTIONS);
      await writeFile(file, `${systemPrompt.trim()}\n`, { mode: 0o600 });
      config.instructions = [file];
    }
    return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
  },

  sessionFields: () => ({}),

  needsPromptPreamble: () => false,
};
