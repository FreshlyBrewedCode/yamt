import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

/** Who an MCP request comes from. */
export type McpPrincipal =
  /** The long-lived token in the data dir: interactive Claude Code / T3 sessions, full access. */
  | { kind: "interactive" }
  /** An analysis run (#8): may read and write its own meal only. */
  | { kind: "run"; runId: string; mealId: string };

/** Run tokens expire on their own if a run never revokes them (it crashed). */
export const RUN_TOKEN_TTL_MS = 2 * 60 * 60_000;

/** `yamt_` + 256 random bits: the prefix makes a leaked token recognisable to secret scanners. */
const newToken = () => `yamt_${randomBytes(32).toString("base64url")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest();

interface RunToken {
  runId: string;
  mealId: string;
  expiresAt: number;
}

/**
 * Bearer tokens for `/mcp`:
 *
 * - **Interactive:** one long-lived token in `<data>/mcp-token` (0600), created on first use and
 *   printed by `yamt mcp-token` for `export YAMT_MCP_TOKEN=…`. Rotating renames a new file into
 *   place; a running server notices (it re-reads the file when its inode or mtime changes).
 * - **Per run:** `mintRun` gives an analysis run a token scoped to one meal; `revokeRun` ends it
 *   when the run finishes, and it expires after `ttlMs` regardless. Kept in memory only (as
 *   hashes): a run never outlives the server process.
 */
export class McpTokens {
  private runs = new Map<string, RunToken>();
  private interactive: { stamp: string; hash: Buffer } | null = null;

  constructor(
    private readonly tokenFile: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The interactive token, created (0600) if there is none yet. */
  interactiveToken(): string {
    if (existsSync(this.tokenFile)) {
      const token = readFileSync(this.tokenFile, "utf8").trim();
      if (token) return token;
    }
    return this.rotateInteractive();
  }

  /** A new interactive token; the old one stops working at once. */
  rotateInteractive(): string {
    const token = newToken();
    const tmp = `${this.tokenFile}.${process.pid}.tmp`;
    writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.tokenFile);
    this.interactive = null;
    return token;
  }

  /** A token for one analysis run, valid for its meal only. */
  mintRun(run: { runId: string; mealId: string; ttlMs?: number }): string {
    const token = newToken();
    this.runs.set(sha256(token).toString("hex"), {
      runId: run.runId,
      mealId: run.mealId,
      expiresAt: this.now() + (run.ttlMs ?? RUN_TOKEN_TTL_MS),
    });
    return token;
  }

  /** Ends every token of the run (it finished, failed or was cancelled). */
  revokeRun(runId: string): void {
    for (const [hash, t] of this.runs) if (t.runId === runId) this.runs.delete(hash);
  }

  /** For `requireBearer`: the principal, or null for an unknown, revoked or expired token. */
  verify = (token: string): McpPrincipal | null => {
    const hash = sha256(token);
    const run = this.runs.get(hash.toString("hex"));
    if (run) {
      if (run.expiresAt > this.now()) return { kind: "run", runId: run.runId, mealId: run.mealId };
      this.runs.delete(hash.toString("hex"));
      return null;
    }
    const interactive = this.interactiveHash();
    return interactive && timingSafeEqual(interactive, hash) ? { kind: "interactive" } : null;
  };

  private interactiveHash(): Buffer | null {
    let stamp: string;
    try {
      const st = statSync(this.tokenFile);
      stamp = `${st.ino}:${st.mtimeMs}`;
    } catch {
      return null;
    }
    if (this.interactive?.stamp !== stamp) {
      const token = readFileSync(this.tokenFile, "utf8").trim();
      this.interactive = token ? { stamp, hash: sha256(token) } : null;
    }
    return this.interactive?.hash ?? null;
  }
}
