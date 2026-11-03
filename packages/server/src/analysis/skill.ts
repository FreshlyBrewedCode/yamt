import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The `log-meal` skill: one file for the analysis job (its text is appended to the harness's
 * system prompt) and for interactive Claude Code sessions in the repo (`.claude/skills` links to
 * `.agents/skills`). Read at the start of every run, so an edit applies to the next one.
 */
export const SKILL_PATH = join(import.meta.dir, "../../../../.agents/skills/log-meal/SKILL.md");

export interface Skill {
  path: string;
  /** The instructions without the YAML frontmatter. */
  text: string;
  sha256: string;
}

export async function loadSkill(path = SKILL_PATH): Promise<Skill> {
  const raw = await readFile(path, "utf8");
  const text = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  if (!text) throw new Error(`the skill at ${path} is empty`);
  return { path, text, sha256: new Bun.CryptoHasher("sha256").update(raw).digest("hex") };
}
