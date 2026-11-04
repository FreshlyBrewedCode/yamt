import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCodeAdapter } from "../src/acp/adapters/claude-code.ts";
import { customAdapter } from "../src/acp/adapters/custom.ts";
import type { SessionFieldsContext } from "../src/acp/adapters/types.ts";
import { httpMcpServer } from "../src/acp/mcp.ts";
import { pickOption } from "../src/acp/run.ts";
import { agentPhoto } from "../src/analysis/prompt.ts";
import { TraceWriter } from "../src/analysis/trace.ts";
import { openDb } from "../src/db/index.ts";
import type { CaptureRecord } from "../src/db/repos/captures.ts";
import { dedupeKeys, JobRepo, type JobType } from "../src/db/repos/jobs.ts";
import { type JobHandler, type JobOutcome, JobWorker } from "../src/jobs/worker.ts";
import { boxResize, downscaleJpeg, reorient } from "../src/media/downscale.ts";
import { MediaStore, sha256Hex } from "../src/media/store.ts";
import { tempDir } from "./helpers.ts";

const sleep = (ms: number) => Bun.sleep(ms);

describe("job worker", () => {
  let worker: JobWorker | null = null;
  afterEach(async () => {
    await worker?.stop();
    worker = null;
  });

  /** A handler whose jobs finish when the test releases them. */
  function gated<T extends JobType>(type: T, concurrency: number) {
    const started: string[] = [];
    const release = new Map<string, (o: JobOutcome) => void>();
    let peak = 0;
    let live = 0;
    const settled: string[] = [];
    const handler: JobHandler<T> = {
      type,
      concurrency,
      run: (job, ctx) => {
        started.push(job.id);
        peak = Math.max(peak, ++live);
        return new Promise<JobOutcome>((resolve) => {
          const done = (o: JobOutcome) => {
            live--;
            resolve(o);
          };
          release.set(job.id, done);
          ctx.signal.addEventListener("abort", () =>
            done({ status: "reschedule", runAfter: Date.now(), reason: "stopped" }),
          );
        });
      },
      settled: (job) => settled.push(`${job.id}:${job.status}`),
    };
    return { handler, started, release, settled, peak: () => peak };
  }

  test("runs each type up to its own concurrency, side by side", async () => {
    const jobs = new JobRepo(openDb(":memory:"));
    const analyse = gated("analyse", 1);
    const transcribe = gated("transcribe", 2);
    worker = new JobWorker(jobs, { pollMs: 10 })
      .register(analyse.handler)
      .register(transcribe.handler)
      .start();
    for (const m of ["m1", "m2", "m3"])
      jobs.enqueue("analyse", { mealId: m }, { dedupeKey: dedupeKeys.analyse(m) });
    for (const c of ["c1", "c2", "c3"]) jobs.enqueue("transcribe", { captureId: c });
    await sleep(60);
    expect(worker.runningCount("analyse")).toBe(1);
    expect(worker.runningCount("transcribe")).toBe(2);
    for (const id of [...analyse.started]) analyse.release.get(id)!({ status: "done" });
    for (const id of [...transcribe.started]) transcribe.release.get(id)!({ status: "done" });
    await sleep(60);
    expect(analyse.started).toHaveLength(2);
    expect(transcribe.started).toHaveLength(3);
    expect(analyse.peak()).toBe(1);
    expect(transcribe.peak()).toBe(2);
    expect(analyse.settled[0]).toEndWith(":done");
  });

  test("outcomes: failed backs off, reschedule spends no attempt, a throw is a retryable failure", async () => {
    const jobs = new JobRepo(openDb(":memory:"));
    const outcomes: JobOutcome[] = [
      { status: "failed", error: "boom" },
      { status: "reschedule", runAfter: Date.now() + 60_000, reason: "waiting" },
    ];
    let calls = 0;
    const handler: JobHandler<"analyse"> = {
      type: "analyse",
      concurrency: 1,
      run: async () => {
        const o = outcomes[calls++];
        if (!o) throw new Error("thrown");
        return o;
      },
    };
    worker = new JobWorker(jobs, { pollMs: 10 }).register(handler).start();
    const a = jobs.enqueue("analyse", { mealId: "a" }).job;
    await sleep(50);
    expect(jobs.get(a.id)).toMatchObject({ status: "queued", attempts: 1, lastError: "boom" });
    const b = jobs.enqueue("analyse", { mealId: "b" }).job;
    await sleep(50);
    expect(jobs.get(b.id)).toMatchObject({ status: "queued", attempts: 0, lastError: "waiting" });
    const c = jobs.enqueue("analyse", { mealId: "c" }).job;
    await sleep(50);
    expect(jobs.get(c.id)).toMatchObject({ status: "queued", attempts: 1, lastError: "thrown" });
  });

  test("wake() picks a new job up before the next tick; stop() aborts and waits", async () => {
    const jobs = new JobRepo(openDb(":memory:"));
    let signal: AbortSignal | null = null;
    const handler: JobHandler<"analyse"> = {
      type: "analyse",
      concurrency: 1,
      run: (_job, ctx) => {
        signal = ctx.signal;
        return new Promise((resolve) =>
          ctx.signal.addEventListener("abort", () =>
            resolve({ status: "reschedule", runAfter: Date.now(), reason: "stopped" }),
          ),
        );
      },
    };
    worker = new JobWorker(jobs, { pollMs: 60_000 }).register(handler).start();
    await sleep(20);
    const j = jobs.enqueue("analyse", { mealId: "a" }).job;
    worker.wake();
    await sleep(20);
    expect(jobs.get(j.id)?.status).toBe("running");
    await worker.stop();
    expect(signal!.aborted).toBe(true);
    expect(jobs.get(j.id)).toMatchObject({ status: "queued", attempts: 0 });
  });
});

describe("harness adapters", () => {
  const ctx = (over: Partial<SessionFieldsContext> = {}): SessionFieldsContext => ({
    cwd: "/tmp/run",
    systemPrompt: "# Log a meal",
    model: "claude-opus-5-5",
    capabilities: { sessionCapabilities: { systemPrompt: {} } },
    mcp: {
      servers: [httpMcpServer("yamt", "http://127.0.0.1:7890/mcp", "yamt_secret")],
      allowedTools: ["mcp__yamt", "WebFetch"],
      credential: { server: "yamt", token: "yamt_secret" },
    },
    builtInTools: ["Read", "WebFetch"],
    isolated: true,
    ...over,
  });

  test("Claude Code: token off the command line, model, tools, isolation, appended skill", () => {
    const f = claudeCodeAdapter.sessionFields(ctx());
    expect(f.mcpServers).toEqual([
      {
        type: "http",
        name: "yamt",
        url: "http://127.0.0.1:7890/mcp",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code expands it from the env
        headers: [{ name: "Authorization", value: "Bearer ${YAMT_MCP_TOKEN}" }],
      },
    ]);
    expect(f.systemPrompt).toEqual({ mode: "append", content: [{ type: "text", text: "# Log a meal" }] });
    expect(f._meta).toEqual({
      claudeCode: {
        options: {
          env: { ENABLE_TOOL_SEARCH: "false", YAMT_MCP_TOKEN: "yamt_secret" },
          promptSuggestions: false,
          model: "claude-opus-5-5",
          allowedTools: ["mcp__yamt", "WebFetch"],
          tools: ["Read", "WebFetch"],
          settingSources: [],
        },
      },
    });
    // without the spec capability: the _meta fallback
    const old = claudeCodeAdapter.sessionFields(ctx({ capabilities: {} }));
    expect(old.systemPrompt).toBeUndefined();
    expect((old._meta as { systemPrompt: unknown }).systemPrompt).toEqual({ append: "# Log a meal" });
  });

  test("custom: spec system prompt or a preamble; the model through config options", () => {
    expect(customAdapter.sessionFields(ctx()).systemPrompt?.mode).toBe("append");
    expect(customAdapter.needsPromptPreamble(ctx())).toBe(false);
    expect(customAdapter.needsPromptPreamble(ctx({ capabilities: {} }))).toBe(true);
    expect(customAdapter.modelViaMeta).toBe(false);
  });

  test("permission options are picked by kind, once before always", () => {
    const options = [
      { optionId: "a", name: "Always", kind: "allow_always" as const },
      { optionId: "o", name: "Once", kind: "allow_once" as const },
      { optionId: "r", name: "No", kind: "reject_always" as const },
    ];
    expect(pickOption(options, "allow")).toBe("o");
    expect(pickOption(options, "reject")).toBe("r");
    expect(pickOption(options.slice(0, 2), "reject")).toBeNull();
  });
});

describe("trace", () => {
  test("redacts secrets anywhere and replaces image data by its size", () => {
    const path = join(tempDir(), "trace.ndjson");
    const w = new TraceWriter(path, 1000, ["yamt_secret"], () => 1250);
    w.write("session.new", { request: { _meta: { env: { T: "yamt_secret" } }, h: "Bearer yamt_secret" } });
    w.write("prompt", { prompt: [{ type: "image", mimeType: "image/jpeg", data: "AAAA" }] });
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({
      t: 250,
      at: 1250,
      kind: "session.new",
      request: { _meta: { env: { T: "[redacted]" } }, h: "Bearer [redacted]" },
    });
    expect(lines[1].prompt[0].data).toBe("[base64, 3 bytes]");
  });
});

describe("photo downscaling", () => {
  /** A w×h RGBA raster whose pixel (x, y) has r = x, g = y. */
  const raster = (w: number, h: number) => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 0, 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  const px = (r: { width: number; data: Uint8Array }, x: number, y: number) =>
    Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 2));

  test("box resize keeps the aspect ratio and averages", () => {
    const small = boxResize(raster(8, 4), 4);
    expect([small.width, small.height]).toEqual([4, 2]);
    expect(px(small, 0, 0)).toEqual([1, 1]); // mean of x 0..1, y 0..1 → 0.5, rounded
    expect(boxResize(raster(3, 2), 10).width).toBe(3);
  });

  test("EXIF orientations turn the pixels upright", () => {
    const src = raster(3, 2); // top-left (0,0), top-right (2,0)
    expect(px(reorient(src, 3), 0, 0)).toEqual([2, 1]); // 180°
    const cw = reorient(src, 6); // 90° clockwise: 2×3, top-left was bottom-left
    expect([cw.width, cw.height]).toEqual([2, 3]);
    expect(px(cw, 0, 0)).toEqual([0, 1]);
    expect(px(cw, 1, 0)).toEqual([0, 0]);
    const ccw = reorient(src, 8); // 90° counter-clockwise: top-left was top-right
    expect(px(ccw, 0, 0)).toEqual([2, 0]);
  });

  test("a large JPEG comes back at 1600 px on the long side; a small one as it is", async () => {
    const { encode } = await import("jpeg-js");
    const big = raster(2400, 1200);
    const jpeg = new Uint8Array(encode({ ...big, data: Buffer.from(big.data) }, 80).data);
    const out = await downscaleJpeg(jpeg);
    expect([out.width, out.height]).toEqual([1600, 800]);
    const { decode } = await import("jpeg-js");
    expect(decode(out.bytes).width).toBe(1600);
    const tiny = new Uint8Array(
      encode({ ...raster(40, 20), data: Buffer.from(raster(40, 20).data) }, 80).data,
    );
    expect((await downscaleJpeg(tiny)).bytes).toBe(tiny);

    // as the agent gets it: a cached copy next to the original, which stays untouched
    const dir = tempDir();
    const media = new MediaStore(dir);
    const rel = "media/2026/11/photo-1.jpg";
    const { sha256 } = await media.write(rel, jpeg);
    const capture = {
      id: "photo-1",
      kind: "image",
      mimeType: "image/jpeg",
      mediaPath: rel,
      jpegPath: null,
      takenAt: null,
      capturedAt: null,
      createdAt: 1,
    } as unknown as CaptureRecord;
    const first = await agentPhoto(capture, media);
    expect(first.path).toBe(join(dir, "media/2026/11/photo-1.1600.jpg"));
    expect(sha256Hex(await Bun.file(media.absolute(rel)).bytes())).toBe(sha256);
    expect((await agentPhoto(capture, media)).path).toBe(first.path);
  });
});
