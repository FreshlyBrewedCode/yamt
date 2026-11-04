import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CaptureResponse, mealPaths, type TranscribeResponse, type Transcript } from "@yamt/shared";
import { DEFAULT_STT_SETTINGS, dataPaths } from "../src/config.ts";
import { openDb } from "../src/db/index.ts";
import { createRepos } from "../src/db/repos/index.ts";
import { dedupeKeys, JobRepo } from "../src/db/repos/jobs.ts";
import { type JobHandler, type JobOutcome, JobWorker } from "../src/jobs/worker.ts";
import { groupAlive } from "../src/procs.ts";
import { type AppServer, createServer } from "../src/server.ts";
import type { SttResult } from "../src/transcription/backend.ts";
import { NormaliseError, normalise, normaliseArgs } from "../src/transcription/ffmpeg.ts";
import { settleTranscript } from "../src/transcription/job.ts";
import { LocalWhisperBackend, parseSttLine, sttRequest } from "../src/transcription/local.ts";
import { NIX_FFMPEG_LINK, resolveFfmpeg, ToolMissingError } from "../src/transcription/tools.ts";
import { fixture, tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

const FAKE_STT = [process.execPath, join(import.meta.dir, "fake-stt.ts")];
const FAKE_FFMPEG = join(import.meta.dir, "fake-ffmpeg.ts");
const FAKE_AGENT = join(import.meta.dir, "fake-agent.ts");
const MEMO = fixture("memo-de.m4a"); // made up: espeak-ng reading a German lunch, AAC in M4A

async function waitFor<T>(what: string, fn: () => T | null | undefined | false, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

/** A real ffmpeg if there is one without building anything (PATH, YAMT_FFMPEG, the nix link). */
function realFfmpeg(): string | null {
  const linked = join(`${NIX_FFMPEG_LINK}-bin`, "bin", "ffmpeg");
  return process.env.YAMT_FFMPEG || Bun.which("ffmpeg") || (existsSync(linked) ? linked : null);
}

/** Channels, rate, bits and data size of a canonical PCM WAV. */
function wavHeader(b: Buffer) {
  return {
    riff: b.toString("ascii", 0, 4),
    wave: b.toString("ascii", 8, 12),
    format: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    rate: b.readUInt32LE(24),
    bits: b.readUInt16LE(34),
  };
}

describe("normalising with ffmpeg", () => {
  test("the command: first audio stream only → 16 kHz mono s16 WAV, never prompting", () => {
    const args = normaliseArgs("/data/media/2026/11/a.m4a", "/tmp/x/a.wav");
    expect(args[0]).toBe("-nostdin");
    expect(args[args.indexOf("-i") + 1]).toBe("/data/media/2026/11/a.m4a");
    expect(args.at(-1)).toBe("/tmp/x/a.wav");
    const pair = (flag: string) => args[args.indexOf(flag) + 1];
    expect([pair("-map"), pair("-ac"), pair("-ar"), pair("-c:a"), pair("-f")]).toEqual([
      "0:a:0",
      "1",
      "16000",
      "pcm_s16le",
      "wav",
    ]);
    expect(args).toContain("-vn");
    // the output may be overwritten (a retry in the same dir), the input is only ever read
    expect(args.indexOf("-y")).toBeGreaterThan(args.indexOf("-i") + 1);
  });

  const ffmpeg = realFfmpeg();
  test.skipIf(!ffmpeg)(
    "real ffmpeg: an iOS-style M4A becomes 16 kHz mono PCM; the original is untouched",
    async () => {
      const dir = tempDir();
      const input = join(dir, "memo.m4a");
      writeFileSync(input, MEMO);
      const output = join(dir, "memo.wav");
      await normalise(ffmpeg!, input, output);
      const wav = readFileSync(output);
      expect(wavHeader(wav)).toEqual({
        riff: "RIFF",
        wave: "WAVE",
        format: 1,
        channels: 1,
        rate: 16000,
        bits: 16,
      });
      const seconds = (wav.length - 44) / 32000;
      expect(seconds).toBeGreaterThan(8.5);
      expect(seconds).toBeLessThan(9.5);
      expect(new Uint8Array(readFileSync(input))).toEqual(MEMO);

      const junk = join(dir, "junk.m4a");
      writeFileSync(junk, "junk, not audio at all");
      const err = await normalise(ffmpeg!, junk, join(dir, "junk.wav")).catch((e) => e);
      expect(err).toBeInstanceOf(NormaliseError);
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("can't read the audio");
    },
  );

  test("finding ffmpeg: the configured path must exist; PATH next; without nix a clear error", async () => {
    expect(await resolveFfmpeg({ configured: FAKE_FFMPEG })).toBe(FAKE_FFMPEG);
    await expect(resolveFfmpeg({ configured: "/nope/ffmpeg" })).rejects.toThrow("not found at /nope/ffmpeg");
    const nixLink = join(tempDir(), ".ffmpeg");
    expect(
      await resolveFfmpeg({
        configured: null,
        nixLink,
        which: (c) => (c === "ffmpeg" ? "/usr/bin/ffmpeg" : null),
      }),
    ).toBe("/usr/bin/ffmpeg");
    const missing = await resolveFfmpeg({ configured: null, nixLink, which: () => null }).catch((e) => e);
    expect(missing).toBeInstanceOf(ToolMissingError);
    expect(missing.message).toContain("YAMT_FFMPEG");
  });
});

describe("the STT process protocol", () => {
  test("lines are parsed into events; anything else is ignored", () => {
    expect(
      parseSttLine(
        '{"event":"result","id":"c1","ok":true,"text":"Haferflocken","language":"de","durationMs":3000,"segments":[{"startMs":0,"endMs":3000,"text":"Haferflocken"}],"model":"faster-whisper large-v3-turbo int8","elapsedMs":600}',
      ),
    ).toMatchObject({ event: "result", ok: true, text: "Haferflocken", durationMs: 3000 });
    expect(parseSttLine('{"event":"result","id":"c1","ok":false,"error":"boom"}')).toEqual({
      event: "result",
      id: "c1",
      ok: false,
      error: "boom",
    });
    expect(parseSttLine('{"event":"download","bytes":123}')).toEqual({ event: "download", bytes: 123 });
    expect(parseSttLine("Downloading model.bin: 45%")).toBeNull();
    expect(parseSttLine('{"event":"result","id":"c1","ok":true}')).toBeNull(); // no text
    expect(parseSttLine('{"event":"bogus"}')).toBeNull();
    expect(parseSttLine("{not json")).toBeNull();
  });

  test("the request carries the settings and where models go", () => {
    expect(sttRequest(DEFAULT_STT_SETTINGS, "/data/models", [{ id: "c1", path: "/tmp/c1.wav" }])).toEqual({
      settings: { ...DEFAULT_STT_SETTINGS, modelsDir: "/data/models" },
      items: [{ id: "c1", path: "/tmp/c1.wav" }],
    });
  });

  /** Two made-up WAVs (fake ffmpeg output) and a backend on the fake STT process. */
  async function batch(
    script: string,
    opts: { idleMs?: number; signal?: AbortSignal; command?: string[] } = {},
  ) {
    const dir = tempDir();
    const items = [];
    for (const id of ["c1", "c2"]) {
      writeFileSync(join(dir, `${id}.m4a`), new Uint8Array(2048));
      Bun.spawnSync([FAKE_FFMPEG, "-i", join(dir, `${id}.m4a`), join(dir, `${id}.wav`)]);
      items.push({ id, path: join(dir, `${id}.wav`) });
    }
    const record = join(dir, "record.ndjson");
    const logs: string[] = [];
    const backend = new LocalWhisperBackend({
      command: opts.command ?? FAKE_STT,
      settings: { ...DEFAULT_STT_SETTINGS, initialPrompt: "Haferflocken" },
      modelsDir: join(dir, "models"),
      env: { FAKE_STT_SCRIPT: script, FAKE_STT_RECORD: record },
      idleMs: opts.idleMs,
      log: (l) => logs.push(l),
    });
    const results: [string, SttResult][] = [];
    const end = await backend.transcribe(items, {
      signal: opts.signal ?? new AbortController().signal,
      onResult: (id, r) => results.push([id, r]),
    });
    const requests = existsSync(record)
      ? readFileSync(record, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
    return { end, results, requests, logs, backend };
  }

  test("one process per batch: every file's result as it comes, with the settings it ran with", async () => {
    const { end, results, requests, logs, backend } = await batch("ok");
    expect(end).toEqual({ status: "ok" });
    expect(requests).toHaveLength(1);
    expect(requests[0].items.map((i: { id: string }) => i.id)).toEqual(["c1", "c2"]);
    expect(requests[0].settings).toMatchObject({
      model: "large-v3-turbo",
      threads: 4,
      initialPrompt: "Haferflocken",
    });
    expect(requests[0].infos[0]).toMatchObject({
      riff: true,
      channels: 1,
      rate: 16000,
      bits: 16,
      durationMs: 1000,
    });
    expect(results.map(([id]) => id)).toEqual(["c1", "c2"]);
    expect(results[0]![1]).toMatchObject({
      ok: true,
      language: "de",
      durationMs: 1000,
      model: "fake-whisper",
      settings: { computeType: "int8", beamSize: 1, vad: true, initialPrompt: "Haferflocken" },
    });
    expect(logs.some((l) => l.includes("fake-whisper loaded"))).toBe(true);
    expect(backend.describe()).toBe("faster-whisper large-v3-turbo int8, 4 threads, beam 1, VAD, de");
  });

  test("a crash mid-batch keeps what was answered and fails the rest, retryably, with stderr", async () => {
    const { end, results } = await batch("crash");
    expect(results.map(([id]) => id)).toEqual(["c1"]);
    expect(end).toMatchObject({ status: "error", retryable: true });
    expect((end as { error: string }).error).toContain("code 3");
    expect((end as { error: string }).error).toContain("MemoryError: fake out of memory");
  });

  test("a model that can't load is the batch's error", async () => {
    const { end, results } = await batch("fatal");
    expect(results).toEqual([]);
    expect(end).toEqual({
      status: "error",
      error: "loading fake-model failed: RuntimeError: no such model",
      retryable: true,
    });
  });

  test("a missing command is not retried", async () => {
    const { end } = await batch("ok", { command: ["/nope/stt"] });
    expect(end).toMatchObject({ status: "error", retryable: false });
  });

  test("silence beyond the idle limit stops the whole group; so does the server stopping", async () => {
    const idle = await batch("hang", { idleMs: 300 });
    expect(idle.end).toMatchObject({ status: "error", retryable: true });
    expect((idle.end as { error: string }).error).toContain("said nothing");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 300);
    const stopped = await batch("hang", { signal: abort.signal });
    expect(stopped.end).toEqual({ status: "aborted" });
  });
});

describe("worker batches", () => {
  test("a batch handler gets up to batchSize due jobs at once and one outcome each", async () => {
    const jobs = new JobRepo(openDb(":memory:"));
    for (const c of ["c1", "c2", "c3"]) jobs.enqueue("transcribe", { captureId: c });
    const batches: string[][] = [];
    const handler: JobHandler<"transcribe"> = {
      type: "transcribe",
      concurrency: 1,
      batchSize: 2,
      run: async () => ({ status: "done" }),
      runBatch: async (js) => {
        batches.push(js.map((j) => j.payload.captureId));
        return js.map(
          (j): JobOutcome =>
            j.payload.captureId === "c2" ? { status: "failed", error: "x" } : { status: "done" },
        );
      },
    };
    const worker = new JobWorker(jobs, { pollMs: 10 }).register(handler).start();
    await waitFor("both batches", () => batches.length >= 2);
    await worker.stop();
    expect(batches).toEqual([["c1", "c2"], ["c3"]]);
    const status = Object.fromEntries(
      jobs.list().map((j) => [(j.payload as { captureId: string }).captureId, j.status]),
    );
    expect(status).toEqual({ c1: "done", c2: "queued", c3: "done" });
  });

  test("at startup, an interrupted transcription without attempts left fails its transcript", () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    const meal = repos.meals.insert({});
    repos.captures.insert({
      id: "c1",
      mealId: meal.id,
      kind: "audio",
      media: {
        mimeType: "audio/mp4",
        path: "media/2026/11/c1.m4a",
        byteSize: 1,
        sha256: "0",
        fileName: null,
      },
    });
    repos.transcripts.upsertPending("c1");
    repos.jobs.enqueue(
      "transcribe",
      { captureId: "c1" },
      { dedupeKey: dedupeKeys.transcribe("c1"), maxAttempts: 1 },
    );
    repos.jobs.claim();
    const [job] = repos.jobs.releaseInterrupted();
    expect(settleTranscript(repos, job!)).toBe(true);
    expect(repos.transcripts.get("c1")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("interrupted"),
    });
  });
});

describe("transcription in the server", () => {
  const dataDir = join(tempDir(), "data");
  const scriptFile = join(tempDir(), "stt-script");
  const record = join(tempDir(), "stt-record.ndjson");
  let ffmpegMissing = false;
  const app: AppServer = createServer({
    dataDir,
    port: 0,
    webDist: null,
    auth: { kind: "off" },
    worker: { pollMs: 20 },
    analysis: {
      config: {
        harness: { kind: "custom", command: process.execPath, args: [FAKE_AGENT], env: {} },
        model: "fake-smart",
      },
      timeouts: { idleMs: 3000, toolIdleMs: 3000, turnMs: 10_000, cancelGraceMs: 300 },
      // far longer than any test waits: an analysis only goes early when a transcript nudges it
      transcriptWaitMs: 60_000,
    },
    transcription: {
      backend: new LocalWhisperBackend({
        command: FAKE_STT,
        settings: DEFAULT_STT_SETTINGS,
        modelsDir: dataPaths(dataDir).models,
        env: { FAKE_STT_SCRIPT_FILE: scriptFile, FAKE_STT_RECORD: record },
        log: () => {},
      }),
      ffmpeg: async () => {
        if (ffmpegMissing) throw new ToolMissingError("ffmpeg not found: install it");
        return FAKE_FFMPEG;
      },
    },
  });
  afterAll(() => app.stop());
  const s = app.services;
  beforeEach(() => {
    writeFileSync(scriptFile, "ok");
    ffmpegMissing = false;
  });

  const api = async <T>(method: string, path: string, body?: FormData | object) => {
    const res = await fetch(new URL(path, app.localUrl), {
      method,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      headers: {
        origin: new URL(app.localUrl).origin,
        ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      },
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const meal = (...texts: string[]) => {
    const m = s.meals.create({});
    for (const text of texts) s.meals.addJson(m.id, { kind: "text", text });
    return m.id;
  };
  const uploadMemo = async (mealId: string, bytes: Uint8Array = MEMO) => {
    const form = new FormData();
    form.set("file", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mp4" }), "memo.m4a");
    form.set("kind", "audio");
    const res = await api<CaptureResponse>("POST", mealPaths.captures(mealId), form);
    expect(res.status).toBe(201);
    return res.body.capture.id;
  };
  const transcript = (captureId: string) => s.repos.transcripts.get(captureId)!;
  const transcribeJobs = (captureId: string) =>
    s.repos.jobs.list({ type: "transcribe" }).filter((j) => j.dedupeKey === dedupeKeys.transcribe(captureId));
  const settled = (captureId: string, status: Transcript["status"]) =>
    waitFor(`transcript ${status}`, () => transcript(captureId).status === status && transcript(captureId));
  const retryNow = () =>
    s.repos.db.query("UPDATE jobs SET run_after = 0 WHERE status = 'queued' AND type = 'transcribe'").run();

  test("upload → transcript → the waiting analysis goes at once and reads it", async () => {
    const mealId = meal("fake:save");
    const memo = await uploadMemo(mealId);
    s.meals.analyse(mealId);
    const done = await settled(memo, "done");
    expect(done).toMatchObject({
      text: "Zum Frühstück achtzig Gramm Haferflocken mit Milch.",
      model: "fake-whisper",
      language: "de",
      elapsedMs: 12,
      settings: { model: "large-v3-turbo", computeType: "int8", threads: 4, vad: true },
      error: null,
    });
    expect(done.segments).toHaveLength(1);
    expect(done.durationMs).toBeGreaterThan(0);
    // nudged: the analysis doesn't wait out its 60 s re-check
    await waitFor("analysed", () => s.repos.meals.get(mealId)!.status === "analysed");
    // the meal is analysed inside save_meal_revision; the agent writes its record after that call
    // returns, so read it once the run has ended
    const run = await waitFor("the run ended", () =>
      s.repos.runs.listForMeal(mealId).find((r) => r.status !== "running"),
    );
    expect(run.status).toBe("succeeded");
    expect(run.startedAt - done.updatedAt).toBeLessThan(2000);
    const agent = JSON.parse(readFileSync(join(dataPaths(dataDir).runs, run.id, "fake-agent.json"), "utf8"));
    expect(agent.transcripts).toEqual([
      { status: "done", text: "Zum Frühstück achtzig Gramm Haferflocken mit Milch." },
    ]);
    // the original is as uploaded
    const rec = s.repos.captures.get(memo)!;
    expect(new Uint8Array(readFileSync(join(dataDir, rec.mediaPath!)))).toEqual(MEMO);
    expect(transcribeJobs(memo)).toMatchObject([{ status: "done", attempts: 1 }]);
  });

  test("a spoken answer is transcribed like a memo; the re-analysis waits for it and reads it", async () => {
    const mealId = meal("fake:question");
    s.meals.analyse(mealId);
    await waitFor("needs input", () => s.repos.meals.get(mealId)!.status === "needs_input");
    const question = s.revisions.current(s.repos.meals.get(mealId)!)!.questions[0]!;
    const form = new FormData();
    form.set("file", new Blob([MEMO], { type: "audio/mp4" }), "voice-memo.m4a");
    form.set("kind", "answer");
    form.set("questionId", question.id);
    const res = await api<CaptureResponse>("POST", mealPaths.captures(mealId), form);
    expect(res.body.capture).toMatchObject({ kind: "answer", questionId: question.id });
    s.meals.analyse(mealId);
    await settled(res.body.capture.id, "done");
    // the agent writes its record after save_meal_revision returns: read it once the run has ended
    const [run] = await waitFor("the re-analysis ended", () => {
      const ended = s.repos.runs.listForMeal(mealId).filter((r) => r.status !== "running");
      return ended.length === 2 && ended;
    });
    expect(run!.status).toBe("succeeded");
    expect(s.repos.meals.get(mealId)!.status).toBe("needs_input");
    const agent = JSON.parse(readFileSync(join(dataPaths(dataDir).runs, run!.id, "fake-agent.json"), "utf8"));
    expect(agent.captureKinds).toEqual(["text", "answer"]);
    expect(agent.transcripts).toEqual([
      { status: "done", text: "Zum Frühstück achtzig Gramm Haferflocken mit Milch." },
    ]);
  });

  test("failures retry with backoff while the transcript stays pending; then failed, and the analysis goes on", async () => {
    writeFileSync(scriptFile, "fail");
    const mealId = meal("fake:save");
    const memo = await uploadMemo(mealId);
    s.meals.analyse(mealId);
    await waitFor(
      "first failure",
      () => transcribeJobs(memo)[0]?.attempts === 1 && transcribeJobs(memo)[0]?.status === "queued",
    );
    const [first] = transcribeJobs(memo);
    expect(first!.runAfter - first!.updatedAt).toBe(30_000);
    expect(transcript(memo).status).toBe("pending");
    expect(s.repos.meals.get(mealId)!.status).toBe("queued");
    retryNow();
    await waitFor(
      "second failure",
      () => transcribeJobs(memo)[0]?.attempts === 2 && transcribeJobs(memo)[0]?.status === "queued",
    );
    retryNow();
    const failed = await settled(memo, "failed");
    expect(failed.error).toContain("fake decoder failure");
    expect(transcribeJobs(memo)).toMatchObject([{ status: "failed", attempts: 3 }]);
    await waitFor("analysed", () => s.repos.meals.get(mealId)!.status === "analysed");
  });

  test("a file ffmpeg can't read, or a missing ffmpeg, fails at once (retrying won't help)", async () => {
    const junk = await uploadMemo(meal(), new TextEncoder().encode("junk, not audio at all"));
    expect((await settled(junk, "failed")).error).toContain("Invalid data found");
    expect(transcribeJobs(junk)).toMatchObject([{ status: "failed", attempts: 1 }]);

    ffmpegMissing = true;
    const memo = await uploadMemo(meal());
    expect((await settled(memo, "failed")).error).toBe("ffmpeg not found: install it");
  });

  test("an STT process that can't load its model is retried; the transcript stays pending", async () => {
    writeFileSync(scriptFile, "fatal");
    const memo = await uploadMemo(meal());
    await waitFor(
      "retry queued",
      () => transcribeJobs(memo)[0]?.status === "queued" && transcribeJobs(memo)[0]?.attempts === 1,
    );
    expect(transcribeJobs(memo)[0]!.lastError).toContain("no such model");
    expect(transcript(memo).status).toBe("pending");
    writeFileSync(scriptFile, "ok");
    retryNow();
    await settled(memo, "done");
  });

  test("POST /api/captures/:id/transcribe re-runs it: old text replaced, audio kept, no re-analysis", async () => {
    const mealId = meal("fake:save");
    const memo = await uploadMemo(mealId);
    s.meals.analyse(mealId);
    await settled(memo, "done");
    await waitFor("analysed", () => s.repos.meals.get(mealId)!.status === "analysed");
    const analyses = s.repos.jobs.list({ type: "analyse" }).length;

    writeFileSync(scriptFile, "slow:300");
    const env = await api<TranscribeResponse>("POST", mealPaths.transcribe(memo));
    expect(env.status).toBe(200);
    expect(env.body.transcript).toMatchObject({
      captureId: memo,
      status: "pending",
      text: null,
      model: null,
    });
    expect(env.body.capture.id).toBe(memo);
    // idempotent while queued or running: one job
    await api("POST", mealPaths.transcribe(memo));
    await settled(memo, "done");
    expect(s.repos.meals.get(mealId)!.status).toBe("analysed");
    expect(s.repos.jobs.list({ type: "analyse" })).toHaveLength(analyses);
    const rec = s.repos.captures.get(memo)!;
    expect(new Uint8Array(readFileSync(join(dataDir, rec.mediaPath!)))).toEqual(MEMO);

    // refusals
    expect((await api("POST", mealPaths.transcribe("nope"))).status).toBe(404);
    const text = s.repos.captures.listForMeal(mealId).find((c) => c.kind === "text")!;
    expect((await api("POST", mealPaths.transcribe(text.id))).status).toBe(400);
    s.meals.retract(memo);
    expect((await api("POST", mealPaths.transcribe(memo))).status).toBe(409);
  });

  test("stopping the server mid-transcription kills the STT process and requeues the job", async () => {
    const dir = join(tempDir(), "data");
    const pids = join(tempDir(), "pids");
    const script = join(tempDir(), "script");
    writeFileSync(script, "hang");
    const local = createServer({
      dataDir: dir,
      port: 0,
      webDist: null,
      auth: { kind: "off" },
      worker: { pollMs: 20 },
      transcription: {
        backend: new LocalWhisperBackend({
          command: ["sh", "-c", `echo $$ >> ${pids}; exec "$0" "$@"`, ...FAKE_STT],
          settings: DEFAULT_STT_SETTINGS,
          modelsDir: dataPaths(dir).models,
          env: { FAKE_STT_SCRIPT_FILE: script },
          log: () => {},
        }),
        ffmpeg: async () => FAKE_FFMPEG,
      },
    });
    const m = local.services.meals.create({});
    const form = new File([MEMO], "memo.m4a", { type: "audio/mp4" });
    const { capture } = await local.services.meals.addUpload(m.id, form, { kind: "audio" });
    await waitFor("STT process", () => existsSync(pids));
    await Bun.sleep(200);
    const pid = Number(readFileSync(pids, "utf8").trim());
    expect(groupAlive(pid)).toBe(true);
    await local.stop();
    expect(groupAlive(pid)).toBe(false);
    const again = createServer({ dataDir: dir, port: 0, webDist: null, auth: { kind: "off" } });
    const [job] = again.services.repos.jobs.list({ type: "transcribe" });
    expect(job).toMatchObject({ status: "queued", attempts: 0, lastError: "server stopped" });
    expect(again.services.repos.transcripts.get(capture.id)?.status).toBe("pending");
    await again.stop();
  });
});
