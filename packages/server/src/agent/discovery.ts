import { mkdirSync } from "node:fs";
import type { AgentChoice, AgentOption, AgentOptionsResponse, DiscoveryFailure } from "@yamt/shared";
import { adapters, type HarnessConfig } from "../acp/adapters/index.ts";
import { choices, effortOption, modelOption, type SelectOption } from "../acp/config-options.ts";
import { type DiscoverOptions, type DiscoverResult, discoverOptions } from "../acp/discover.ts";

/** A harness that couldn't be asked (not installed, not logged in, broken). */
export class DiscoveryError extends Error {
  constructor(
    readonly failure: DiscoveryFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface DiscoveryOptions {
  /** The scratch working directory discoveries run in (one, reused: harnesses keep per-dir state). */
  dir: string;
  /** How long a result is kept (default an hour). */
  ttlMs?: number;
  now?: () => number;
  /** Seam for tests. */
  discover?: (o: DiscoverOptions) => Promise<DiscoverResult>;
  timeoutMs?: number;
}

interface Entry {
  at: number;
  value: AgentOptionsResponse;
}

/**
 * What each harness offers, per model: its models and the efforts of a model, read by starting
 * the harness (no prompt, so no tokens) and kept for an hour. One discovery at a time (each
 * starts a harness process); asking for the same thing while it runs shares the answer. Failures
 * are not kept, so a login fixed meanwhile shows on the next ask.
 */
export class AgentDiscovery {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<AgentOptionsResponse>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly discover: (o: DiscoverOptions) => Promise<DiscoverResult>;

  constructor(private readonly o: DiscoveryOptions) {
    this.ttlMs = o.ttlMs ?? 60 * 60_000;
    this.now = o.now ?? Date.now;
    this.discover = o.discover ?? discoverOptions;
  }

  /** The options of `harness`, with `model` selected first (null: its default); `refresh` asks again. */
  async options(
    harness: HarnessConfig,
    model: string | null,
    { refresh = false }: { refresh?: boolean } = {},
  ): Promise<AgentOptionsResponse> {
    const key = `${harness.kind}\0${model ?? ""}`;
    if (refresh) this.forget(harness.kind);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.enqueue(() => this.run(harness, model)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    const value = await p;
    this.cache.set(key, { at: value.discoveredAt, value });
    return value;
  }

  /** Drop what is known about one harness (Refresh). */
  forget(kind: string): void {
    for (const k of this.cache.keys()) if (k.startsWith(`${kind}\0`)) this.cache.delete(k);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private async run(harness: HarnessConfig, model: string | null): Promise<AgentOptionsResponse> {
    mkdirSync(this.o.dir, { recursive: true, mode: 0o700 });
    const r = await this.discover({
      harness,
      adapter: adapters[harness.kind],
      cwd: this.o.dir,
      model,
      timeoutMs: this.o.timeoutMs,
    });
    if (!r.ok) throw new DiscoveryError(r.failure, r.error);
    const models = modelOption(r.configOptions);
    const effort = effortOption(r.configOptions);
    return {
      harness: harness.kind,
      model,
      agent: r.agentInfo
        ? { name: r.agentInfo.title ?? r.agentInfo.name, version: r.agentInfo.version ?? null }
        : null,
      models: models ? toOption(models) : null,
      effort: effort ? toOption(effort) : null,
      discoveredAt: this.now(),
    };
  }
}

/**
 * A select as the app shows it. OpenCode lists ~600 models as "Provider/Model" without groups:
 * the provider becomes the group, so the picker can file them under it.
 */
function toOption(opt: SelectOption): AgentOption {
  const flat = choices(opt);
  const grouped = flat.some((c) => c.group !== null);
  return {
    id: opt.id,
    name: opt.name,
    current: opt.currentValue,
    choices: flat.map(
      (c): AgentChoice => ({
        ...c,
        group: grouped ? c.group : c.name.includes("/") ? (c.name.split("/")[0] ?? null) : null,
      }),
    ),
  };
}
