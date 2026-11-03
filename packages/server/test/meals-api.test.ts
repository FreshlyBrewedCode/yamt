import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalyseResponse,
  type ApiError,
  type CaptureResponse,
  type MealDetailResponse,
  type MealResponse,
  type MealsResponse,
  mealPaths,
  type RetractResponse,
  type WeightEntryResponse,
  type WeightResponse,
  weightPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { createServer } from "../src/server.ts";
import { fixture, tempDir } from "./helpers.ts";

const dataDir = join(tempDir(), "data");
let failHeic = false;
const app = createServer({
  dataDir,
  port: 0,
  webDist: null,
  auth: { kind: "tailnet", login: "alice@example.com" },
  heicToJpeg: async (heic) => {
    if (failHeic) throw new Error("no decoder");
    const { heicToJpeg } = await import("../src/media/heic.ts");
    return heicToJpeg(heic);
  },
});
afterAll(() => app.stop());

const url = (path: string) => new URL(path, app.localUrl).toString();
const AUTH = { [IDENTITY_HEADER]: "alice@example.com" };

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...AUTH, ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(url(path), init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as T };
}

const newMeal = async (body: unknown = {}) =>
  (await call<MealResponse>("POST", mealPaths.meals, body)).body.meal;

/** Made-up bytes with the header of an `.m4a` (ISO-BMFF ftyp, brand M4A). */
const fakeM4a = () => {
  const head = new TextEncoder().encode("\0\0\0\x14ftypM4A \0\0\0\0M4A ");
  return new Uint8Array([...head, ...new Array(300).fill(7)]);
};

function upload(file: Blob, name: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", file, name);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

describe("auth", () => {
  test("the new routes need the identity, and writes our origin", async () => {
    expect((await fetch(url(mealPaths.meals))).status).toBe(401);
    expect((await fetch(url(weightPaths.weight))).status).toBe(401);
    const cross = await call("POST", mealPaths.meals, {}, { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
  });
});

describe("meals", () => {
  test("create a draft, read it back, 404 for unknown ids", async () => {
    const meal = await newMeal();
    expect(meal).toMatchObject({ status: "draft", eatenAtSource: "created", currentRevisionId: null });
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body).toEqual({ meal, captures: [], transcripts: [], revision: null, runs: [] });
    expect((await call("GET", mealPaths.meal("nope"))).status).toBe(404);
  });

  test("bodies are validated", async () => {
    expect((await call<ApiError>("POST", mealPaths.meals, { eatenAt: "noon" })).status).toBe(400);
    expect((await call<ApiError>("POST", mealPaths.meals, { colour: "red" })).status).toBe(400);
    const res = await fetch(url(mealPaths.meals), {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{oops",
    });
    expect(res.status).toBe(400);
  });

  test("list by eatenAt range with capture counts", async () => {
    const t = Date.UTC(2030, 0, 1, 12);
    const a = await newMeal({ eatenAt: t });
    const b = await newMeal({ eatenAt: t + 3_600_000 });
    await newMeal({ eatenAt: t + 86_400_000 });
    await call("POST", mealPaths.captures(b.id), { kind: "text", text: "Müsli mit Joghurt" });
    const res = await call<MealsResponse>("GET", `${mealPaths.meals}?from=${t}&to=${t + 86_400_000}`);
    expect(res.body.meals.map((m) => m.id)).toEqual([b.id, a.id]);
    expect(res.body.meals[0]).toMatchObject({ status: "draft", captureCount: 1, captureKinds: { text: 1 } });
    expect((await call("GET", `${mealPaths.meals}?from=yesterday`)).status).toBe(400);
  });
});

describe("JSON captures", () => {
  test("text, link, correction and answer", async () => {
    const meal = await newMeal();
    const capturedAt = Date.now() - 60_000;
    const text = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      kind: "text",
      text: "  Zwei Brötchen mit Käse  ",
      capturedAt,
    });
    expect(text.status).toBe(201);
    expect(text.body.capture).toMatchObject({
      kind: "text",
      text: "Zwei Brötchen mit Käse",
      capturedAt,
      mimeType: null,
    });
    expect(text.body.transcript).toBeNull();
    expect(text.body.meal).toMatchObject({ eatenAt: capturedAt, eatenAtSource: "capture" });

    const link = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      kind: "link",
      url: "https://example.com/recipe",
    });
    expect(link.body.capture).toMatchObject({ kind: "link", url: "https://example.com/recipe", text: null });
    for (const kind of ["correction", "answer"] as const) {
      const res = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
        kind,
        text: "Es war nur ein halbes",
      });
      expect(res.body.capture.kind).toBe(kind);
    }
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body.captures.map((c) => c.kind)).toEqual(["text", "link", "correction", "answer"]);
  });

  test("invalid captures are refused", async () => {
    const meal = await newMeal();
    const post = (body: unknown) => call<ApiError>("POST", mealPaths.captures(meal.id), body);
    expect((await post({ kind: "text", text: "   " })).status).toBe(400);
    expect((await post({ kind: "link", url: "javascript:alert(1)" })).status).toBe(400);
    expect((await post({ kind: "audio", text: "x" })).status).toBe(400);
    expect((await post({ kind: "text", text: "x", capturedAt: Date.now() + 86_400_000 })).status).toBe(400);
    expect((await call("POST", mealPaths.captures("nope"), { kind: "text", text: "x" })).status).toBe(404);
    const plain = await fetch(url(mealPaths.captures(meal.id)), {
      method: "POST",
      headers: { ...AUTH, "content-type": "text/plain" },
      body: "hello",
    });
    expect(plain.status).toBe(415);
  });
});

describe("uploads", () => {
  test("audio: stored byte for byte, a pending transcript and a transcribe job", async () => {
    const meal = await newMeal();
    const bytes = fakeM4a();
    const res = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([bytes], { type: "audio/x-m4a" }), "Kochen.m4a"),
    );
    expect(res.status).toBe(201);
    const { capture, transcript } = res.body;
    expect(capture).toMatchObject({
      kind: "audio",
      mimeType: "audio/mp4",
      byteSize: bytes.length,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      fileName: "Kochen.m4a",
      jpegDerivative: null,
    });
    expect(transcript).toMatchObject({ captureId: capture.id, status: "pending" });

    const record = app.services.repos.captures.get(capture.id)!;
    expect(record.mediaPath).toMatch(new RegExp(`^media/\\d{4}/\\d{2}/${capture.id}\\.m4a$`));
    expect(new Uint8Array(readFileSync(join(dataDir, record.mediaPath!)))).toEqual(bytes);
    const jobs = app.services.repos.jobs
      .list({ type: "transcribe" })
      .filter((j) => j.dedupeKey?.endsWith(capture.id));
    expect(jobs).toMatchObject([{ status: "queued", payload: { captureId: capture.id } }]);

    // the transcript shows up in the meal
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body.transcripts).toMatchObject([{ captureId: capture.id, status: "pending" }]);
  });

  test("kind follows the content when not given; Safari's MediaRecorder audio/mp4 works", async () => {
    const meal = await newMeal();
    const rec = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "recording.mp4", {
        capturedAt: String(Date.now()),
      }),
    );
    expect(rec.body.capture).toMatchObject({ kind: "audio", mimeType: "audio/mp4" });
    const pdf = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob(["%PDF-1.7 made up"], { type: "application/pdf" }), "menu.pdf"),
    );
    expect(pdf.body.capture).toMatchObject({ kind: "file", mimeType: "application/pdf" });
  });

  test("JPEG photo: EXIF time recorded and used for eatenAt; no derivative needed", async () => {
    const meal = await newMeal();
    const res = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fixture("gradient.jpg")], { type: "image/jpeg" }), "IMG_0001.JPG", { kind: "image" }),
    );
    const taken = Date.UTC(2026, 9, 30, 11, 34, 56);
    expect(res.body.capture).toMatchObject({
      kind: "image",
      mimeType: "image/jpeg",
      takenAt: taken,
      jpegDerivative: null,
    });
    expect(res.body.meal).toMatchObject({ eatenAt: taken, eatenAtSource: "capture" });
    expect((await call("GET", mealPaths.mediaJpeg(res.body.capture.id))).status).toBe(404);
  });

  test("HEIC photo: original kept, JPEG derivative stored next to it and served", async () => {
    const meal = await newMeal();
    const heic = fixture("gradient.heic");
    const res = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([heic], { type: "image/heic" }), "IMG_0002.HEIC"),
    );
    const { capture } = res.body;
    expect(capture).toMatchObject({ kind: "image", mimeType: "image/heic", jpegDerivative: "ok" });
    const original = await fetch(url(mealPaths.media(capture.id)), { headers: AUTH });
    expect(original.headers.get("content-type")).toBe("image/heic");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(heic);
    const jpeg = await fetch(url(mealPaths.mediaJpeg(capture.id)), { headers: AUTH });
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await jpeg.arrayBuffer()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const record = app.services.repos.captures.get(capture.id)!;
    expect(record.jpegPath).toBe(record.mediaPath!.replace(/\.heic$/, ".jpg"));
  });

  test("HEIC photo whose conversion fails: original kept, derivative marked missing", async () => {
    const meal = await newMeal();
    failHeic = true;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await call<CaptureResponse>(
        "POST",
        mealPaths.captures(meal.id),
        upload(new Blob([fixture("gradient.heic")], { type: "image/heic" }), "IMG_0003.HEIC"),
      );
      expect(res.status).toBe(201);
      expect(res.body.capture).toMatchObject({ mimeType: "image/heic", jpegDerivative: "missing" });
      const original = await fetch(url(mealPaths.media(res.body.capture.id)), { headers: AUTH });
      expect(original.status).toBe(200);
      await original.arrayBuffer();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      failHeic = false;
      warn.mockRestore();
    }
  });

  test("refused uploads leave no files behind", async () => {
    const meal = await newMeal();
    const before = app.services.repos.captures.listForMeal(meal.id).length;
    const notImage = await call<ApiError>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob(["%PDF-1.7"], { type: "application/pdf" }), "x.pdf", { kind: "image" }),
    );
    expect(notImage.status).toBe(400);
    const empty = await call("POST", mealPaths.captures(meal.id), upload(new Blob([]), "empty.m4a"));
    expect(empty.status).toBe(400);
    const noFile = new FormData();
    noFile.set("kind", "audio");
    expect((await call("POST", mealPaths.captures(meal.id), noFile)).status).toBe(400);
    const badKind = await call(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob(["x"]), "x", { kind: "video" }),
    );
    expect(badKind.status).toBe(400);
    expect(app.services.repos.captures.listForMeal(meal.id)).toHaveLength(before);
  });
});

describe("media", () => {
  test("range requests for audio playback, caching headers, auth", async () => {
    const meal = await newMeal();
    const bytes = fakeM4a();
    const { body } = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([bytes], { type: "audio/mp4" }), "memo.m4a"),
    );
    const path = mealPaths.media(body.capture.id);
    expect((await fetch(url(path))).status).toBe(401);

    const full = await fetch(url(path), { headers: AUTH });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("content-length")).toBe(String(bytes.length));
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-disposition")).toStartWith("inline");
    const etag = full.headers.get("etag")!;
    expect(etag).toBe(`"${body.capture.sha256}"`);
    await full.arrayBuffer();

    const part = await fetch(url(path), { headers: { ...AUTH, range: "bytes=4-11" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 4-11/${bytes.length}`);
    expect(await part.text()).toBe("ftypM4A ");

    const tail = await fetch(url(path), { headers: { ...AUTH, range: "bytes=-10" } });
    expect(tail.status).toBe(206);
    expect((await tail.arrayBuffer()).byteLength).toBe(10);

    const beyond = await fetch(url(path), { headers: { ...AUTH, range: `bytes=${bytes.length}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe(`bytes */${bytes.length}`);

    expect((await fetch(url(path), { headers: { ...AUTH, "if-none-match": etag } })).status).toBe(304);
    expect((await call("GET", mealPaths.media("nope"))).status).toBe(404);
  });

  test("files that are not plainly media download instead of rendering on our origin", async () => {
    const meal = await newMeal();
    const { body } = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "page.html"),
    );
    expect(body.capture).toMatchObject({ kind: "file", mimeType: "text/html" });
    const res = await fetch(url(mealPaths.media(body.capture.id)), { headers: AUTH });
    expect(res.headers.get("content-disposition")).toStartWith("attachment");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    await res.arrayBuffer();
  });

  test("text captures have no media", async () => {
    const meal = await newMeal();
    const { body } = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      kind: "text",
      text: "x",
    });
    expect((await call("GET", mealPaths.media(body.capture.id))).status).toBe(404);
  });
});

describe("retract", () => {
  test("soft and idempotent; the audio's queued transcription is cancelled; the file stays", async () => {
    const meal = await newMeal();
    const { body } = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "oops.m4a"),
    );
    const id = body.capture.id;
    const first = await call<RetractResponse>("POST", mealPaths.retract(id));
    expect(first.status).toBe(200);
    expect(first.body.capture.retractedAt).toBeNumber();
    expect(first.body.meal.eatenAtSource).toBe("created");
    const again = await call<RetractResponse>("POST", mealPaths.retract(id));
    expect(again.body.capture.retractedAt).toBe(first.body.capture.retractedAt);

    const job = app.services.repos.jobs.list().find((j) => j.dedupeKey === `transcribe:${id}`);
    expect(job?.status).toBe("cancelled");
    expect(existsSync(join(dataDir, app.services.repos.captures.get(id)!.mediaPath!))).toBe(true);
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body.captures[0]?.retractedAt).toBe(first.body.capture.retractedAt);
    expect((await call("POST", mealPaths.retract("nope"))).status).toBe(404);
  });
});

describe("analyse", () => {
  test("needs a live capture; queues the meal and one analyse job, idempotently", async () => {
    const meal = await newMeal();
    expect((await call<ApiError>("POST", mealPaths.analyse(meal.id))).status).toBe(409);
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Pasta" });

    const first = await call<AnalyseResponse>("POST", mealPaths.analyse(meal.id));
    expect(first.status).toBe(200);
    expect(first.body.meal.status).toBe("queued");
    const second = await call<AnalyseResponse>("POST", mealPaths.analyse(meal.id));
    expect(second.body.jobId).toBe(first.body.jobId);
    const jobs = app.services.repos.jobs
      .list({ type: "analyse" })
      .filter((j) => j.dedupeKey === `analyse:${meal.id}`);
    expect(jobs).toMatchObject([{ status: "queued", payload: { mealId: meal.id } }]);
    expect((await call("POST", mealPaths.analyse("nope"))).status).toBe(404);
  });

  test("adding a capture to an analysed meal does not queue it again", async () => {
    const meal = await newMeal();
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Salat" });
    app.services.repos.meals.setStatus(meal.id, "analysed");
    const res = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      kind: "correction",
      text: "ohne Dressing",
    });
    expect(res.body.meal.status).toBe("analysed");
    expect(app.services.repos.jobs.list().some((j) => j.dedupeKey === `analyse:${meal.id}`)).toBe(false);
  });
});

describe("weight", () => {
  test("add, list, delete", async () => {
    const measuredAt = Date.UTC(2031, 0, 1, 7);
    const add = await call<WeightEntryResponse>("POST", weightPaths.weight, {
      kg: 81.3,
      measuredAt,
      note: "morning",
    });
    expect(add.status).toBe(201);
    expect(add.body.entry).toMatchObject({ kg: 81.3, measuredAt, note: "morning", source: "manual" });
    const now = await call<WeightEntryResponse>("POST", weightPaths.weight, { kg: 81 });
    expect(Math.abs(now.body.entry.measuredAt - Date.now())).toBeLessThan(5_000);
    expect((await call("POST", weightPaths.weight, { kg: -1 })).status).toBe(400);
    expect((await call("POST", weightPaths.weight, { kg: "81" })).status).toBe(400);

    const list = await call<WeightResponse>(
      "GET",
      `${weightPaths.weight}?from=${measuredAt}&to=${measuredAt + 1}`,
    );
    expect(list.body.entries.map((e) => e.id)).toEqual([add.body.entry.id]);
    expect((await call("DELETE", weightPaths.entry(add.body.entry.id))).status).toBe(204);
    expect((await call("DELETE", weightPaths.entry(add.body.entry.id))).status).toBe(404);
  });
});
