import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type CaptureResponse,
  type MealDetailResponse,
  type MealResponse,
  mealPaths,
  type TranscribeResponse,
} from "../packages/shared/src/api-meals.ts";

// A voice memo through the real pipeline up to the model: upload → ffmpeg normalises it → the STT
// process (the scripted fake-stt.ts here, see playwright.config.ts) → transcript → the analysis
// that waited for it (the fake agent). The memo is synthetic speech (test/fixtures/memo-de.m4a).
const MEMO = readFileSync(resolve("packages/server/test/fixtures/memo-de.m4a"));

test("a voice memo is transcribed, then the meal is analysed with it", async ({ request }) => {
  const { meal } = (await (await request.post(mealPaths.meals, { data: {} })).json()) as MealResponse;
  const upload = await request.post(mealPaths.captures(meal.id), {
    multipart: { kind: "audio", file: { name: "Sprachmemo.m4a", mimeType: "audio/mp4", buffer: MEMO } },
  });
  expect(upload.status()).toBe(201);
  const { capture, transcript } = (await upload.json()) as CaptureResponse;
  expect(transcript?.status).toBe("pending");
  await request.post(mealPaths.captures(meal.id), { data: { kind: "text", text: "fake:save" } });
  expect((await request.post(mealPaths.analyse(meal.id))).ok()).toBe(true);

  const detail = async () =>
    (await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse;
  await expect.poll(async () => (await detail()).meal.status, { timeout: 20_000 }).toBe("analysed");
  const d = await detail();
  expect(d.transcripts).toMatchObject([
    { captureId: capture.id, status: "done", language: "de", model: "fake-whisper", error: null },
  ]);
  // ffmpeg's WAV of the 8.9 s memo is what the STT process measured
  expect(d.transcripts[0]?.durationMs).toBeGreaterThan(8500);
  expect(d.transcripts[0]?.durationMs).toBeLessThan(9500);
  expect(d.runs[0]?.status).toBe("succeeded");

  // a re-run replaces the transcript and leaves the analysis alone
  const again = (await (await request.post(mealPaths.transcribe(capture.id))).json()) as TranscribeResponse;
  expect(again.transcript.status).toBe("pending");
  await expect.poll(async () => (await detail()).transcripts[0]?.status, { timeout: 20_000 }).toBe("done");
  expect((await detail()).runs).toHaveLength(1);
});
