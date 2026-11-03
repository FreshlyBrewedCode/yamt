import { describe, expect, test } from "bun:test";
import {
  extensionFor,
  formatDuration,
  isBusy,
  levelOf,
  pickMimeType,
  type RecorderEvent,
  type RecorderState,
  recorderReducer,
  recordingName,
} from "../src/lib/recorder";

const run = (events: RecorderEvent[], from: RecorderState = { phase: "idle" }) =>
  events.reduce(recorderReducer, from);

describe("recorder state machine", () => {
  test("idle → requesting → recording → stopping → idle", () => {
    expect(run([{ type: "start" }])).toEqual({ phase: "requesting" });
    expect(run([{ type: "start" }, { type: "granted", at: 5 }])).toEqual({
      phase: "recording",
      startedAt: 5,
    });
    const stopping = run([{ type: "start" }, { type: "granted", at: 5 }, { type: "stop" }]);
    expect(stopping).toEqual({ phase: "stopping", startedAt: 5 });
    expect(isBusy(stopping)).toBe(true);
    expect(recorderReducer(stopping, { type: "finished" })).toEqual({ phase: "idle" });
  });

  test("a recording that ends by itself (app sent to the background) finishes from recording", () => {
    expect(run([{ type: "start" }, { type: "granted", at: 1 }, { type: "finished" }])).toEqual({
      phase: "idle",
    });
  });

  test("denied permission is an error the user dismisses or retries from", () => {
    const denied = run([{ type: "start" }, { type: "denied", error: "no mic" }]);
    expect(denied).toEqual({ phase: "error", error: "no mic" });
    expect(recorderReducer(denied, { type: "dismiss" })).toEqual({ phase: "idle" });
    expect(recorderReducer(denied, { type: "start" })).toEqual({ phase: "requesting" });
  });

  test("out-of-place events are ignored", () => {
    const recording: RecorderState = { phase: "recording", startedAt: 1 };
    expect(recorderReducer(recording, { type: "start" })).toBe(recording); // double tap
    expect(recorderReducer(recording, { type: "granted", at: 9 })).toBe(recording);
    expect(run([{ type: "stop" }, { type: "finished" }, { type: "failed", error: "x" }])).toEqual({
      phase: "idle",
    });
    expect(recorderReducer(recording, { type: "failed", error: "boom" })).toEqual({
      phase: "error",
      error: "boom",
    });
  });
});

describe("recorder helpers", () => {
  test("iOS gets audio/mp4, Chromium WebM Opus, else the browser's default", () => {
    expect(pickMimeType((t) => t === "audio/mp4" || t.startsWith("audio/webm"))).toBe("audio/mp4");
    expect(pickMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType(() => false)).toBeNull();
  });

  test("extensions the server's sniffing agrees with", () => {
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/ogg; codecs=opus")).toBe("ogg");
    expect(recordingName(new Date(2026, 10, 3, 19, 5).getTime(), "audio/mp4")).toBe(
      "voice-memo-2026-11-03-1905.m4a",
    );
  });

  test("levels: silence is 0, a full-scale square wave is 1", () => {
    expect(levelOf(new Uint8Array(256).fill(128))).toBe(0);
    expect(levelOf(Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 0 : 255)))).toBe(1);
    const quiet = levelOf(Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 120 : 136)));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(0.5);
  });

  test("durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_900)).toBe("0:42");
    expect(formatDuration(725_000)).toBe("12:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});
