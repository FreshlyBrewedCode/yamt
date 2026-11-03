import { appendFileSync } from "node:fs";
import type { RunEvent } from "../acp/run.ts";

/**
 * A run's trace: `<data>/runs/<run id>/trace.ndjson` (0600), one JSON object per line with `t`
 * (ms since the run started), `at` (epoch ms) and `kind`: every ACP event of the run as it
 * happened, plus `run.start` and `run.end`. Lines are appended synchronously, so a crash keeps
 * everything up to it. Secrets (the run's MCP token) are redacted wherever they appear, and
 * base64 image data is replaced by its size.
 */
export class TraceWriter {
  constructor(
    readonly path: string,
    private readonly startedAt: number,
    private readonly secrets: string[] = [],
    private readonly now: () => number = Date.now,
  ) {}

  write(kind: string, fields: Record<string, unknown> = {}): void {
    const at = this.now();
    const secrets = this.secrets;
    const line = JSON.stringify({ t: at - this.startedAt, at, kind, ...fields }, function (key, value) {
      if (typeof value !== "string") return value;
      const holder = this as Record<string, unknown>;
      if (key === "data" && (holder.type === "image" || holder.type === "audio")) {
        return `[base64, ${Math.floor((value.length * 3) / 4)} bytes]`;
      }
      let v = value;
      for (const s of secrets) if (s && v.includes(s)) v = v.replaceAll(s, "[redacted]");
      return v;
    });
    try {
      appendFileSync(this.path, `${line}\n`, { mode: 0o600 });
    } catch (e) {
      console.error(`trace ${this.path}: write failed`, e);
    }
  }

  event(e: RunEvent): void {
    const { type, ...fields } = e;
    this.write(type, fields);
  }
}
