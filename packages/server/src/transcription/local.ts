import { z } from "zod";
import type { SttSettings } from "../config.ts";
import { stopGroup } from "../procs.ts";
import type { SttBackend, SttBatchEnd, SttBatchOptions, SttItem } from "./backend.ts";
import { tail } from "./tools.ts";

const Segment = z.object({ startMs: z.number(), endMs: z.number(), text: z.string() });

/** One line of the STT process's NDJSON output (services/stt/yamt_stt/protocol.py). */
export const SttEvent = z.union([
  z.object({
    event: z.literal("model"),
    state: z.enum(["cached", "downloading"]),
    model: z.string(),
    dir: z.string().nullish(),
  }),
  z.object({
    event: z.literal("download"),
    bytes: z.number().nullish(),
    done: z.boolean().optional(),
    elapsedMs: z.number().optional(),
  }),
  z.object({ event: z.literal("loaded"), model: z.string(), loadMs: z.number() }),
  z.object({ event: z.literal("progress"), id: z.string(), positionMs: z.number(), durationMs: z.number() }),
  z.object({
    event: z.literal("result"),
    id: z.string(),
    ok: z.literal(true),
    text: z.string(),
    language: z.string().nullish(),
    durationMs: z.number().nullish(),
    segments: z.array(Segment),
    model: z.string(),
    elapsedMs: z.number().nullish(),
  }),
  z.object({ event: z.literal("result"), id: z.string(), ok: z.literal(false), error: z.string() }),
  z.object({ event: z.literal("fatal"), error: z.string() }),
  z.object({ event: z.literal("end") }),
]);
export type SttEvent = z.infer<typeof SttEvent>;

/** A stdout line as an event; null for anything else (a stray print from a library). */
export function parseSttLine(line: string): SttEvent | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const r = SttEvent.safeParse(JSON.parse(t));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The request the STT process reads on stdin. */
export function sttRequest(settings: SttSettings, modelsDir: string, items: SttItem[]) {
  return { settings: { ...settings, modelsDir }, items: items.map((i) => ({ id: i.id, path: i.path })) };
}

export interface LocalWhisperOptions {
  /** The STT process's command line (services/stt/run.sh transcribe, or a fake in tests). */
  command: string[];
  settings: SttSettings;
  modelsDir: string;
  env?: Record<string, string>;
  /** Kill the process after this long without a line on stdout (download progress counts). */
  idleMs?: number;
  log?: (line: string) => void;
}

const MB = 1024 * 1024;

/**
 * faster-whisper on this VM's CPU: one short-lived `services/stt` process per batch, which loads
 * the model once (~5 s, ~1.7 GB), transcribes every file, reports each result as a line on
 * stdout and exits, so nothing is held while idle. It runs in its own process group at a lower
 * priority with `threads` threads; a server stop kills the group.
 */
export class LocalWhisperBackend implements SttBackend {
  private readonly log: (line: string) => void;

  constructor(private readonly o: LocalWhisperOptions) {
    this.log = o.log ?? ((l) => console.log(l));
  }

  describe(): string {
    const s = this.o.settings;
    return `faster-whisper ${s.model} ${s.computeType}, ${s.threads} threads, beam ${s.beamSize}${s.vad ? ", VAD" : ""}, ${s.language}`;
  }

  async transcribe(items: SttItem[], opts: SttBatchOptions): Promise<SttBatchEnd> {
    if (items.length === 0) return { status: "ok" };
    const [cmd, ...args] = this.o.command;
    let proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
    try {
      proc = Bun.spawn([cmd!, ...args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
        env: { ...process.env, ...this.o.env },
      });
    } catch (e) {
      return {
        status: "error",
        error: `the STT process can't start (${this.o.command.join(" ")}): ${(e as Error).message}`,
        retryable: false,
      };
    }
    const kill = () => (proc.pid ? stopGroup(proc.pid, 2000) : Promise.resolve());
    proc.stdin.write(JSON.stringify(sttRequest(this.o.settings, this.o.modelsDir, items)));
    await proc.stdin.end();

    let fatal: string | null = null;
    let idle = false;
    let lastLine = Date.now();
    let lastDownloadLog = 0;
    const answered = new Set<string>();
    const idleMs = this.o.idleMs ?? 10 * 60_000;
    const timer = setInterval(
      () => {
        if (Date.now() - lastLine > idleMs) {
          idle = true;
          void kill();
        }
      },
      Math.min(1000, idleMs),
    );
    const onAbort = () => void kill();
    opts.signal.addEventListener("abort", onAbort, { once: true });

    const onEvent = (e: SttEvent) => {
      switch (e.event) {
        case "model":
          if (e.state === "downloading") {
            this.log(
              `transcription: downloading the ${e.model} model into ${e.dir ?? "the Hugging Face cache"} (first use; large-v3-turbo is ~1.6 GB, this can take minutes)`,
            );
          }
          break;
        case "download":
          if (e.done) this.log(`transcription: model downloaded (${mb(e.bytes)}) in ${secs(e.elapsedMs)}`);
          else if (Date.now() - lastDownloadLog > 15_000) {
            lastDownloadLog = Date.now();
            this.log(`transcription: downloading… ${mb(e.bytes)} so far`);
          }
          break;
        case "loaded":
          this.log(`transcription: ${e.model} loaded in ${secs(e.loadMs)}`);
          break;
        case "result":
          answered.add(e.id);
          if (e.ok) {
            opts.onResult(e.id, {
              ok: true,
              text: e.text,
              language: e.language ?? null,
              durationMs: e.durationMs ?? null,
              segments: e.segments,
              model: e.model,
              elapsedMs: e.elapsedMs ?? null,
              settings: { ...this.o.settings },
            });
          } else opts.onResult(e.id, { ok: false, error: e.error });
          break;
        case "fatal":
          fatal = e.error;
          break;
        default:
          break;
      }
    };

    const stderr: string[] = [];
    const reading = Promise.all([
      lines(proc.stdout, (l) => {
        lastLine = Date.now();
        const e = parseSttLine(l);
        if (e) onEvent(e);
      }),
      lines(proc.stderr, (l) => {
        stderr.push(l);
        if (stderr.length > 40) stderr.shift();
        // uv and run.sh say what they set up on a first run; tracebacks go to the error
        if (l.startsWith("stt: ")) this.log(`transcription: ${l.slice(5)}`);
      }),
    ]);
    const code = await proc.exited;
    await reading.catch(() => {});
    clearInterval(timer);
    opts.signal.removeEventListener("abort", onAbort);
    await kill(); // whatever the process left in its group

    if (opts.signal.aborted) return { status: "aborted" };
    if (idle)
      return {
        status: "error",
        error: `the STT process said nothing for ${secs(idleMs)} and was stopped`,
        retryable: true,
      };
    if (fatal) return { status: "error", error: fatal, retryable: true };
    if (code === 0 && items.every((i) => answered.has(i.id))) return { status: "ok" };
    const why = tail(stderr.join("\n"));
    if (code === 127)
      return {
        status: "error",
        error: `the STT process can't run: ${why || "command not found"}`,
        retryable: false,
      };
    return {
      status: "error",
      error: `the STT process exited (${proc.signalCode ?? `code ${code}`}) before finishing${why ? `: ${why}` : ""}`,
      retryable: true,
    };
  }
}

async function lines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i = buf.indexOf("\n");
    while (i >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
  }
  if (buf) onLine(buf);
}

const mb = (bytes: number | null | undefined) => (bytes == null ? "?" : `${Math.round(bytes / MB)} MB`);
const secs = (ms: number | null | undefined) => (ms == null ? "?" : `${(ms / 1000).toFixed(1)} s`);
