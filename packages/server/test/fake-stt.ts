#!/usr/bin/env bun
// A scripted STT process for the transcription tests (and the e2e server): speaks the protocol of
// services/stt (request JSON on stdin, NDJSON events on stdout) without a model. What it does is
// read from the file named by FAKE_STT_SCRIPT_FILE (so a test can change it between runs), else
// FAKE_STT_SCRIPT:
//
//   ok (default)    every item: a result with FAKE_STT_TEXT (or a German default), its WAV's duration
//   fail            every item: a failed result
//   crash           answers the first item, then exits with code 3 (stderr says why)
//   fatal           can't "load the model"
//   hang            loads, then says nothing and ignores SIGTERM
//   slow:<ms>       waits <ms> per item, with progress events
//
// Each request is appended to FAKE_STT_RECORD (one JSON line: the request plus each WAV's header).
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const script = (
  process.env.FAKE_STT_SCRIPT_FILE && existsSync(process.env.FAKE_STT_SCRIPT_FILE)
    ? readFileSync(process.env.FAKE_STT_SCRIPT_FILE, "utf8")
    : (process.env.FAKE_STT_SCRIPT ?? "ok")
).trim();
const text = process.env.FAKE_STT_TEXT ?? "Zum Frühstück achtzig Gramm Haferflocken mit Milch.";

const emit = (event: string, fields: Record<string, unknown> = {}) =>
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);

/** Channels, rate, bits and duration from a canonical PCM WAV header. */
function wavInfo(path: string) {
  const b = readFileSync(path);
  const riff = b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";
  const channels = b.readUInt16LE(22);
  const rate = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  const dataBytes = b.length - 44;
  return {
    riff,
    channels,
    rate,
    bits,
    durationMs: Math.round((dataBytes / (rate * channels * (bits / 8))) * 1000),
  };
}

const req = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
  settings: Record<string, unknown>;
  items: { id: string; path: string }[];
};
const infos = req.items.map((i) => ({ id: i.id, ...wavInfo(i.path) }));
if (process.env.FAKE_STT_RECORD)
  appendFileSync(process.env.FAKE_STT_RECORD, `${JSON.stringify({ ...req, infos })}\n`);

if (script === "fatal") {
  emit("fatal", { error: "loading fake-model failed: RuntimeError: no such model" });
  process.exit(1);
}
emit("model", { state: "cached", model: String(req.settings.model), dir: "/tmp/models" });
emit("loaded", { model: "fake-whisper", loadMs: 5 });
if (script === "hang") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
for (const [n, info] of infos.entries()) {
  if (script === "crash" && n > 0) {
    process.stderr.write("Traceback (most recent call last):\nMemoryError: fake out of memory\n");
    process.exit(3);
  }
  const slow = script.startsWith("slow:") ? Number(script.slice(5)) : 0;
  if (slow) {
    emit("progress", { id: info.id, positionMs: 0, durationMs: info.durationMs });
    await Bun.sleep(slow);
  }
  if (script === "fail") {
    emit("result", { id: info.id, ok: false, error: "RuntimeError: fake decoder failure" });
    continue;
  }
  emit("result", {
    id: info.id,
    ok: true,
    text,
    language: "de",
    durationMs: info.durationMs,
    segments: [{ startMs: 0, endMs: info.durationMs, text }],
    model: "fake-whisper",
    elapsedMs: 12,
  });
}
emit("end");
