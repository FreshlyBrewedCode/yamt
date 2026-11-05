import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalyseResponse,
  type ApiError,
  type CaptureResponse,
  calendarPaths,
  type DayResponse,
  goalPaths,
  type MealDetailResponse,
  type MealResponse,
  type MealRevisionsResponse,
  type MealsResponse,
  type MonthResponse,
  mealPaths,
  type RemoveMealResponse,
  type RepeatableResponse,
  type RepeatMealResponse,
  type RestoreMealResponse,
  type RetractResponse,
  type WeightEntryResponse,
  type WeightResponse,
  weightPaths,
} from "@yamt/shared";
import { IDENTITY_HEADER } from "../src/auth/identity.ts";
import { dedupeKeys } from "../src/db/repos/jobs.ts";
import { localDate } from "../src/domain/time.ts";
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
// writes need our own Origin, as a browser sends it (`sameOrigin`)
const AUTH = { [IDENTITY_HEADER]: "alice@example.com", origin: new URL(app.localUrl).origin };

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
    expect((await fetch(url(mealPaths.revisions("x")))).status).toBe(401);
    const cross = await call("POST", mealPaths.meals, {}, { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const patch = await call(
      "PATCH",
      mealPaths.meal("x"),
      { eatenAt: 1 },
      { origin: "https://evil.example" },
    );
    expect(patch.status).toBe(403);
  });
});

describe("meals", () => {
  test("create a draft, read it back, 404 for unknown ids", async () => {
    const meal = await newMeal();
    expect(meal).toMatchObject({ status: "draft", eatenAtSource: "created", currentRevisionId: null });
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.body).toEqual({
      meal,
      captures: [],
      transcripts: [],
      revision: null,
      runs: [],
      source: null,
    });
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

describe("idempotent creates (client ids)", () => {
  test("a meal and its captures sent twice are stored once", async () => {
    const id = Bun.randomUUIDv7();
    const first = await call<MealResponse>("POST", mealPaths.meals, { id });
    expect(first.status).toBe(201);
    expect(first.body.meal.id).toBe(id);
    const again = await call<MealResponse>("POST", mealPaths.meals, { id });
    expect(again.status).toBe(200);
    expect(again.body.meal).toEqual(first.body.meal);
    expect((await call("POST", mealPaths.meals, { id: "not-a-uuid" })).status).toBe(400);

    const noteId = Bun.randomUUIDv7();
    const note = { id: noteId, kind: "text", text: "Brot mit Käse", capturedAt: Date.now() - 1000 };
    const n1 = await call<CaptureResponse>("POST", mealPaths.captures(id), note);
    expect(n1.status).toBe(201);
    expect(n1.body.capture.id).toBe(noteId);
    const n2 = await call<CaptureResponse>("POST", mealPaths.captures(id), note);
    expect(n2.status).toBe(200);
    expect(n2.body.capture).toEqual(n1.body.capture);

    const memoId = Bun.randomUUIDv7();
    const memo = () => upload(new Blob([fakeM4a()]), "memo.m4a", { id: memoId, kind: "audio" });
    const u1 = await call<CaptureResponse>("POST", mealPaths.captures(id), memo());
    expect(u1.status).toBe(201);
    const u2 = await call<CaptureResponse>("POST", mealPaths.captures(id), memo());
    expect(u2.status).toBe(200);
    expect(u2.body.capture).toEqual(u1.body.capture);
    expect(u2.body.transcript?.status).toBe("pending");

    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(id));
    expect(detail.body.captures.map((c) => c.id)).toEqual([noteId, memoId]);

    // a capture id of this meal sent to another meal is a conflict, not a copy
    const other = await newMeal();
    expect((await call("POST", mealPaths.captures(other.id), note)).status).toBe(409);
  });
});

describe("overview", () => {
  test("title, totals and open questions per meal; per-day totals in the asked zone", async () => {
    const t = Date.UTC(2032, 5, 1, 22, 30); // 00:30 on 2 June in Berlin, still 1 June in UTC
    const late = await newMeal({ eatenAt: t });
    const early = await newMeal({ eatenAt: t - 2 * 3_600_000 });
    const draft = await newMeal({ eatenAt: t - 3 * 3_600_000 });
    await call(
      "POST",
      mealPaths.captures(draft.id),
      upload(new Blob([fakeM4a()]), "m.m4a", { kind: "audio" }),
    );
    const save = (mealId: string, kcal: number, questions = 0) =>
      app.services.revisions.save({
        mealId,
        runId: null,
        title: `Meal ${kcal}`,
        summary: "",
        eatenAt: null,
        assumptions: [],
        items: [
          {
            description: "something",
            grams: 100,
            provenance: "estimate",
            confidence: "medium",
            estimatePer100g: { energyKcal: kcal, protein: 10, fat: 5, carbohydrate: 20, fiber: 2 },
          },
        ],
        questions: Array.from({ length: questions }, (_, i) => ({
          question: `Q${i}?`,
          whyItMatters: "matters",
          impactKcal: 150,
        })),
      });
    save(late.id, 300, 1);
    save(early.id, 500);

    const range = `from=${t - 86_400_000}&to=${t + 1}`;
    const berlin = await call<MealsResponse>("GET", `${mealPaths.meals}?${range}&tz=Europe/Berlin`);
    expect(berlin.status).toBe(200);
    expect(berlin.body.timeZone).toBe("Europe/Berlin");
    expect(berlin.body.meals.map((m) => [m.title, m.totals?.nutrients.energyKcal, m.openQuestions])).toEqual([
      ["Meal 300", 300, 1],
      ["Meal 500", 500, 0],
      [null, undefined, 0],
    ]);
    expect(berlin.body.meals[2]).toMatchObject({ status: "draft", pendingTranscripts: 1, totals: null });
    expect(berlin.body.days).toMatchObject([
      { date: "2032-06-02", meals: 1, unanalysed: 0, totals: { nutrients: { energyKcal: 300 } } },
      {
        date: "2032-06-01",
        meals: 2,
        unanalysed: 1,
        totals: { nutrients: { energyKcal: 500, protein: 10 } },
      },
    ]);

    const utc = await call<MealsResponse>("GET", `${mealPaths.meals}?${range}&tz=UTC`);
    expect(utc.body.days).toMatchObject([
      { date: "2032-06-01", meals: 3, totals: { nutrients: { energyKcal: 800 } } },
    ]);
    expect((await call("GET", `${mealPaths.meals}?tz=Mars/Olympus`)).status).toBe(400);
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

/** A revision for a meal, as an analysis would save it: one estimated item of `grams` at 200 kcal/100 g. */
const saveRevision = (mealId: string, grams: number, questions: string[] = []) =>
  app.services.revisions.save({
    mealId,
    runId: null,
    title: `Curry ${grams}`,
    summary: "",
    eatenAt: null,
    assumptions: [],
    items: [
      {
        description: "Curry",
        grams,
        provenance: "estimate",
        confidence: "low",
        estimatePer100g: { energyKcal: 200, protein: 10, fat: 5, carbohydrate: 20, fiber: 2 },
      },
    ],
    questions: questions.map((question) => ({ question, whyItMatters: "rice", impactKcal: 120 })),
  });

describe("revision history", () => {
  test("every revision newest first, totals from its own items", async () => {
    const meal = await newMeal();
    expect((await call<MealRevisionsResponse>("GET", mealPaths.revisions(meal.id))).body).toEqual({
      revisions: [],
    });
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Curry" });
    const first = saveRevision(meal.id, 400, ["Wie viel Reis?"]);
    await call("POST", mealPaths.captures(meal.id), {
      kind: "answer",
      text: "Nur 150 g",
      questionId: first.questions[0]!.id,
    });
    saveRevision(meal.id, 300);

    const res = await call<MealRevisionsResponse>("GET", mealPaths.revisions(meal.id));
    expect(res.status).toBe(200);
    expect(
      res.body.revisions.map((r) => [r.revision.number, r.revision.status, r.totals.nutrients.energyKcal]),
    ).toEqual([
      [2, "analysed", 600],
      [1, "needs_input", 800],
    ]);
    // an old revision keeps its question and the answer it got
    expect(res.body.revisions[1]?.questions).toMatchObject([
      { question: "Wie viel Reis?", answer: "Nur 150 g" },
    ]);
    expect((await call("GET", mealPaths.revisions("nope"))).status).toBe(404);
  });
});

describe("eaten at", () => {
  test("PATCH pins the time against captures and the analysis; null follows the captures again", async () => {
    const meal = await newMeal();
    const capturedAt = Date.now() - 3_600_000;
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Brot", capturedAt });
    const pinned = Date.now() - 5 * 3_600_000;
    const res = await call<MealResponse>("PATCH", mealPaths.meal(meal.id), { eatenAt: pinned });
    expect(res.status).toBe(200);
    expect(res.body.meal).toMatchObject({ eatenAt: pinned, eatenAtSource: "user" });

    await call("POST", mealPaths.captures(meal.id), {
      kind: "text",
      text: "Butter",
      capturedAt: capturedAt - 60_000,
    });
    app.services.revisions.save({ ...revisionInput(meal.id), eatenAt: capturedAt - 120_000 });
    expect(app.services.repos.meals.get(meal.id)).toMatchObject({ eatenAt: pinned, eatenAtSource: "user" });

    const unpinned = await call<MealResponse>("PATCH", mealPaths.meal(meal.id), { eatenAt: null });
    expect(unpinned.body.meal).toMatchObject({ eatenAt: capturedAt - 60_000, eatenAtSource: "capture" });

    const patch = (body: unknown) => call<ApiError>("PATCH", mealPaths.meal(meal.id), body);
    expect((await patch({ eatenAt: Date.now() + 86_400_000 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ eatenAt: "yesterday" })).status).toBe(400);
    expect((await patch({ eatenAt: pinned, status: "analysed" })).status).toBe(400);
    expect((await call("PATCH", mealPaths.meal("nope"), { eatenAt: pinned })).status).toBe(404);
  });
});

const revisionInput = (mealId: string) => ({
  mealId,
  runId: null,
  title: "Brot",
  summary: "",
  eatenAt: null,
  assumptions: [],
  items: [
    {
      description: "Brot",
      grams: 50,
      provenance: "estimate" as const,
      confidence: "medium" as const,
      estimatePer100g: { energyKcal: 250 },
    },
  ],
  questions: [],
});

describe("spoken answers and corrections", () => {
  test("an answer recorded in place: audio media, a transcript, and it answers its question", async () => {
    const meal = await newMeal();
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Curry" });
    const q = saveRevision(meal.id, 400, ["Wie viel Reis?"]).questions[0]!;

    const res = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "voice-memo.m4a", {
        kind: "answer",
        questionId: q.id,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.capture).toMatchObject({
      kind: "answer",
      questionId: q.id,
      mimeType: "audio/mp4",
      text: null,
    });
    expect(res.body.transcript).toMatchObject({ status: "pending" });
    const id = res.body.capture.id;
    expect(app.services.repos.jobs.list().some((j) => j.dedupeKey === `transcribe:${id}`)).toBe(true);

    // answered at once; the answer's words arrive with the transcript
    let detail = (await call<MealDetailResponse>("GET", mealPaths.meal(meal.id))).body;
    expect(detail.revision?.questions[0]).toMatchObject({ answeredByCaptureId: id, answer: null });
    app.services.repos.transcripts.complete(id, {
      text: "Etwa 150 Gramm",
      model: "fake",
      language: "de",
      durationMs: 1200,
      segments: null,
    });
    detail = (await call<MealDetailResponse>("GET", mealPaths.meal(meal.id))).body;
    expect(detail.revision?.questions[0]?.answer).toBe("Etwa 150 Gramm");
    expect((await call("POST", mealPaths.transcribe(id))).status).toBe(200);

    // a spoken correction works the same way, without a question
    const correction = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "voice-memo.m4a", { kind: "correction" }),
    );
    expect(correction.body.capture).toMatchObject({ kind: "correction", questionId: null });
    expect(correction.body.transcript?.status).toBe("pending");
  });

  test("refused: not audio, a question of another revision, a question on anything but an answer", async () => {
    const meal = await newMeal();
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Curry" });
    const old = saveRevision(meal.id, 400, ["Wie viel Reis?"]).questions[0]!;
    saveRevision(meal.id, 300, ["Welches Öl?"]);
    const post = (fields: Record<string, string>, blob = new Blob([fakeM4a()], { type: "audio/mp4" })) =>
      call<ApiError>("POST", mealPaths.captures(meal.id), upload(blob, "a.m4a", fields));
    expect((await post({ kind: "answer", questionId: old.id })).status).toBe(400);
    expect((await post({ kind: "audio", questionId: old.id })).status).toBe(400);
    const jpeg = new Blob([fixture("gradient.jpg")], { type: "image/jpeg" });
    expect((await post({ kind: "answer" }, jpeg)).status).toBe(400);
    expect((await post({ kind: "correction" }, jpeg)).status).toBe(400);
  });
});

describe("log again (#30)", () => {
  /** An analysed cappuccino: milk from a (made-up) OFF product, an estimated espresso. */
  const cappuccino = async (title = "Cappuccino", eatenAt = Date.now() - 86_400_000) => {
    const meal = await newMeal({ eatenAt });
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "Cappuccino mit Vollmilch" });
    const milk = app.services.repos.foods.save({
      source: "off",
      sourceRef: "4000000000017",
      data: {
        name: "Vollmilch 3,5 %",
        brand: "Testhof",
        per100g: {
          energyKcal: 64,
          protein: 3.3,
          fat: 3.5,
          saturatedFat: 2.3,
          carbohydrate: 4.8,
          sugars: 4.8,
          fiber: 0,
          salt: 0.1,
        },
        nutrients: {},
        portions: [],
      },
      raw: null,
      fetchedAt: Date.now(),
    });
    const view = app.services.revisions.save({
      mealId: meal.id,
      runId: null,
      title,
      summary: "Ein Cappuccino.",
      eatenAt: null,
      assumptions: ["Große Tasse"],
      items: [
        {
          foodId: milk.id,
          description: "Vollmilch",
          grams: 150,
          provenance: "database",
          confidence: "high",
        },
        {
          description: "Espresso",
          grams: 30,
          provenance: "estimate",
          confidence: "low",
          note: "doppelt?",
          estimatePer100g: { energyKcal: 2, protein: 0.1 },
        },
      ],
      questions: [],
    });
    return { meal, view, milk };
  };
  const repeat = (mealId: string, body: unknown) =>
    call<RepeatMealResponse & ApiError>("POST", mealPaths.repeat(mealId), body);

  test("a copy of the current revision: grams scaled, snapshots kept, totals computed, no run", async () => {
    const { meal: source, view, milk } = await cappuccino();
    // the food changes later: the copy keeps the numbers the source was saved with
    app.services.repos.foods.save({
      source: "off",
      sourceRef: "4000000000017",
      data: { ...milk, per100g: { ...milk.per100g, energyKcal: 99 } },
      raw: null,
      fetchedAt: Date.now(),
    });
    const id = crypto.randomUUID();
    const eatenAt = Date.now() - 60_000;
    const res = await repeat(source.id, { id, factor: 1.5, eatenAt, tz: "Europe/Berlin" });
    expect(res.status).toBe(201);
    const { meal, revision } = res.body;
    expect(meal).toMatchObject({
      id,
      status: "analysed",
      eatenAt,
      eatenAtSource: "user",
      sourceMealId: source.id,
      currentRevisionId: revision.revision.id,
    });
    expect(revision.revision).toMatchObject({
      mealId: id,
      number: 1,
      kind: "copy",
      runId: null,
      sourceRevisionId: view.revision.id,
      title: "Cappuccino",
      summary: "Ein Cappuccino.",
      eatenAt,
      status: "analysed",
    });
    const day = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/Berlin",
    })
      .format(source.eatenAt)
      .replace(",", "");
    expect(revision.revision.assumptions).toEqual([
      "Große Tasse",
      `Logged again from Cappuccino (${day}), × 1.5`,
    ]);
    expect(revision.questions).toEqual([]);
    expect(
      revision.items.map((i) => [
        i.description,
        i.grams,
        i.foodId,
        i.provenance,
        i.confidence,
        i.note,
        i.per100g.energyKcal,
      ]),
    ).toEqual([
      ["Vollmilch", 225, milk.id, "database", "high", null, 64],
      ["Espresso", 45, null, "estimate", "low", "doppelt?", 2],
    ]);
    // computeTotals over the copied items: 225 g × 64 + 45 g × 2 per 100 g
    expect(revision.totals.nutrients.energyKcal).toBe(Math.round(2.25 * 64 + 0.45 * 2));
    expect(view.totals.nutrients.energyKcal).toBe(Math.round(1.5 * 64 + 0.3 * 2));

    // the detail links the source; nothing was captured, nothing ran, nothing was queued
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(id));
    expect(detail.body.source).toEqual({ mealId: source.id, title: "Cappuccino", eatenAt: source.eatenAt });
    expect(detail.body).toMatchObject({ captures: [], runs: [] });
    expect(app.services.repos.jobs.list().some((j) => j.dedupeKey === `analyse:${id}`)).toBe(false);

    // the overview and its day count it like any analysed meal
    const list = await call<MealsResponse>("GET", `${mealPaths.meals}?from=${eatenAt}&to=${eatenAt + 1}`);
    expect(list.body.meals).toMatchObject([
      { id, sourceMealId: source.id, captureCount: 0, title: "Cappuccino", status: "analysed" },
    ]);
    expect(list.body.days[0]).toMatchObject({ meals: 1, unanalysed: 0 });
    expect(list.body.days[0]?.totals.nutrients.energyKcal).toBe(revision.totals.nutrients.energyKcal);

    // sent again (a lost response): the stored copy, not a second one
    const again = await repeat(source.id, { id, factor: 1.5, eatenAt });
    expect(again.status).toBe(200);
    expect(again.body.meal.id).toBe(id);
    expect(app.services.repos.revisions.listForMeal(id)).toHaveLength(1);
    // an id of a meal that isn't a copy of this one
    expect((await repeat(source.id, { id: source.id, factor: 1, eatenAt })).status).toBe(409);
    // a copy of the copy is fine and names the copy
    const copy2 = await repeat(id, { factor: 0.5, eatenAt });
    expect(copy2.status).toBe(201);
    expect(copy2.body.meal.sourceMealId).toBe(id);
    expect(copy2.body.revision.items.map((i) => i.grams)).toEqual([112.5, 22.5]);
  });

  test("refused: no finished analysis, a future time, a factor out of range, unknown meals", async () => {
    const draft = await newMeal();
    await call("POST", mealPaths.captures(draft.id), { kind: "text", text: "Suppe" });
    const now = Date.now();
    expect((await repeat(draft.id, { factor: 1, eatenAt: now })).status).toBe(409);
    const asking = await newMeal();
    await call("POST", mealPaths.captures(asking.id), { kind: "text", text: "Curry" });
    saveRevision(asking.id, 300, ["Wie viel Reis?"]);
    const prelim = await repeat(asking.id, { factor: 1, eatenAt: now });
    expect(prelim.status).toBe(409);
    expect(prelim.body.error).toContain("no finished analysis");

    const { meal } = await cappuccino();
    expect((await repeat(meal.id, { factor: 1, eatenAt: now + 2 * 3_600_000 })).status).toBe(400);
    expect((await repeat(meal.id, { factor: 0, eatenAt: now })).status).toBe(400);
    expect((await repeat(meal.id, { factor: 11, eatenAt: now })).status).toBe(400);
    expect((await repeat(meal.id, { factor: 1 })).status).toBe(400);
    expect((await repeat(meal.id, { factor: 1, eatenAt: now, tz: "Mars/Olympus" })).status).toBe(400);
    expect((await repeat("nope", { factor: 1, eatenAt: now })).status).toBe(404);
  });

  test("a copy has nothing to analyse until something is added; then it analyses as usual", async () => {
    const { meal: source } = await cappuccino();
    const copy = (await repeat(source.id, { factor: 1, eatenAt: Date.now() })).body.meal;
    expect((await call<ApiError>("POST", mealPaths.analyse(copy.id))).status).toBe(409);
    await call("POST", mealPaths.captures(copy.id), { kind: "correction", text: "mit Hafermilch" });
    const queued = await call<AnalyseResponse>("POST", mealPaths.analyse(copy.id));
    expect(queued.status).toBe(200);
    expect(queued.body.meal).toMatchObject({ status: "queued", currentRevisionId: copy.currentRevisionId });
  });

  test("what to log again: analysed meals of the last 30 days, one per title, most often first", async () => {
    const day = 86_400_000;
    const now = Date.now();
    const titles = ["Haferbrei", "Toast", "Alt", "Cappuccino"];
    await cappuccino("Haferbrei", now - 3 * day);
    await cappuccino("haferbrei ", now - 2 * day);
    const latest = (await cappuccino("Haferbrei", now - day)).meal;
    await cappuccino("Haferbrei", now - 40 * day); // outside the window
    await cappuccino("Alt", now - 40 * day);
    await cappuccino("Toast", now - 2 * 3_600_000);
    const asking = await newMeal({ eatenAt: now - 3_600_000 });
    await call("POST", mealPaths.captures(asking.id), { kind: "text", text: "Toast?" });
    app.services.revisions.save({
      mealId: asking.id,
      runId: null,
      title: "Toast",
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [],
      questions: [{ question: "Wie viel?", whyItMatters: "Butter", impactKcal: 100 }],
    }); // preliminary: not offered, not counted

    const res = await call<RepeatableResponse>("GET", `${mealPaths.repeatable}?limit=20`);
    expect(res.status).toBe(200);
    const mine = res.body.meals.filter((m) => titles.includes(m.title));
    // the cappuccinos of the tests above: three sources and three copies (copies count as logging it)
    expect(mine.map((m) => [m.title, m.times])).toEqual([
      ["Cappuccino", 6],
      ["Haferbrei", 3],
      ["Toast", 1],
    ]);
    expect(mine[1]).toMatchObject({ mealId: latest.id, eatenAt: now - day });
    expect(mine[1]?.totals.nutrients.energyKcal).toBe(Math.round(1.5 * 64 + 0.3 * 2));
    expect(
      (await call<RepeatableResponse>("GET", mealPaths.repeatable)).body.meals.length,
    ).toBeLessThanOrEqual(5);
    expect((await call("GET", `${mealPaths.repeatable}?days=0`)).status).toBe(400);
  });
});

describe("remove a meal", () => {
  const s = app.services;
  /** An analysed meal eaten `hoursAgo` hours ago: one estimated item of 300 g at 100 kcal/100 g. */
  const analysed = async (title: string, hoursAgo = 2) => {
    const meal = await newMeal({ eatenAt: Date.now() - hoursAgo * 3_600_000 });
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: title });
    s.revisions.save({
      mealId: meal.id,
      runId: null,
      title,
      summary: "",
      eatenAt: null,
      assumptions: [],
      items: [
        {
          description: title,
          grams: 300,
          provenance: "estimate",
          confidence: "medium",
          estimatePer100g: { energyKcal: 100 },
        },
      ],
      questions: [],
    });
    return s.repos.meals.get(meal.id)!;
  };
  const remove = (id: string) => call<RemoveMealResponse & ApiError>("POST", mealPaths.remove(id));
  const restore = (id: string) => call<RestoreMealResponse & ApiError>("POST", mealPaths.restore(id));

  /** Where the meal shows up: the list, its day (and the day's kcal), its month, Log again. */
  const seen = async (meal: { id: string; eatenAt: number }) => {
    const date = localDate(meal.eatenAt, "UTC");
    const list = await call<MealsResponse>("GET", `${mealPaths.meals}?tz=UTC&limit=500`);
    const day = await call<DayResponse>("GET", `${goalPaths.day(date)}?tz=UTC`);
    const month = await call<MonthResponse>("GET", `${calendarPaths.month(date.slice(0, 7))}?tz=UTC`);
    const again = await call<RepeatableResponse>("GET", `${mealPaths.repeatable}?limit=20`);
    return {
      list: list.body.meals.some((m) => m.id === meal.id),
      listDayKcal: list.body.days.find((d) => d.date === date)?.totals.nutrients.energyKcal ?? 0,
      day: day.body.meals.some((m) => m.id === meal.id),
      dayKcal: day.body.totals.nutrients.energyKcal,
      monthMeals: month.body.days.find((d) => d.date === date)?.meals ?? 0,
      monthKcal: month.body.days.find((d) => d.date === date)?.totals?.nutrients.energyKcal ?? 0,
      again: again.body.meals.some((m) => m.mealId === meal.id),
    };
  };

  test("a removed meal leaves the list, its day and totals, the month and Log again; restore brings it back", async () => {
    const meal = await analysed("Entfernter Testkuchen");
    const before = await seen(meal);
    expect(before).toMatchObject({ list: true, day: true, again: true });

    const removed = await remove(meal.id);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ meal: { status: "analysed" }, stoppedAnalysis: false });
    expect(removed.body.meal.removedAt).toBeNumber();
    const after = await seen(meal);
    expect(after).toMatchObject({ list: false, day: false, again: false });
    expect(after.dayKcal).toBe(before.dayKcal - 300);
    expect(after.listDayKcal).toBe(before.listDayKcal - 300);
    expect(after.monthMeals).toBe(before.monthMeals - 1);
    expect(after.monthKcal).toBe(before.monthKcal - 300);

    // still there to look at (and undo): the detail, its captures, its revisions
    const detail = await call<MealDetailResponse>("GET", mealPaths.meal(meal.id));
    expect(detail.status).toBe(200);
    expect(detail.body.meal.removedAt).toBe(removed.body.meal.removedAt);
    expect(detail.body.captures).toHaveLength(1);
    expect(detail.body.revision?.totals.nutrients.energyKcal).toBe(300);
    expect(
      (await call<MealRevisionsResponse>("GET", mealPaths.revisions(meal.id))).body.revisions,
    ).toHaveLength(1);

    // idempotent: the first removal time stays
    expect((await remove(meal.id)).body.meal.removedAt).toBe(removed.body.meal.removedAt);

    const restored = await restore(meal.id);
    expect(restored.status).toBe(200);
    expect(restored.body.meal).toMatchObject({
      removedAt: null,
      status: "analysed",
      currentRevisionId: meal.currentRevisionId,
      eatenAt: meal.eatenAt,
    });
    expect(await seen(meal)).toEqual(before);
    expect((await restore(meal.id)).body.meal.removedAt).toBeNull();
    expect((await remove("01a00000-0000-7000-8000-000000000000")).status).toBe(404);
    expect((await restore("01a00000-0000-7000-8000-000000000000")).status).toBe(404);
  });

  test("a removed draft is no share target: the next share goes elsewhere", async () => {
    const draft = await newMeal();
    await call("POST", mealPaths.captures(draft.id), { kind: "text", text: "Erst geteilt" });
    const joined = await s.share.share({ files: [], texts: ["Dazu"], urls: [] });
    expect(joined).toMatchObject({ meal: { id: draft.id }, newMeal: false });
    await remove(draft.id);
    const next = await s.share.share({ files: [], texts: ["Später"], urls: [] });
    expect(next.meal.id).not.toBe(draft.id);
    expect(s.repos.captures.listForMeal(draft.id)).toHaveLength(2);
  });

  test("writes to a removed meal are refused (409), restore excepted; retried creates still answer", async () => {
    const meal = await analysed("Gesperrter Testkuchen");
    const text = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      id: "01a00000-0000-7000-8000-0000000000a1",
      kind: "text",
      text: "noch was",
    });
    const memo = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(meal.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "memo.m4a"),
    );
    const question = s.repos.revisions.questions(meal.currentRevisionId!)[0];
    expect(question).toBeUndefined();
    await remove(meal.id);

    const refused = [
      await call<ApiError>("POST", mealPaths.captures(meal.id), { kind: "text", text: "mehr" }),
      await call<ApiError>("POST", mealPaths.captures(meal.id), { kind: "correction", text: "2 Stück" }),
      await call<ApiError>("POST", mealPaths.captures(meal.id), { kind: "answer", text: "ja" }),
      await call<ApiError>(
        "POST",
        mealPaths.captures(meal.id),
        upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "more.m4a"),
      ),
      await call<ApiError>("POST", mealPaths.analyse(meal.id)),
      await call<ApiError>("PATCH", mealPaths.meal(meal.id), { eatenAt: Date.now() - 60_000 }),
      await call<ApiError>("POST", mealPaths.repeat(meal.id), { factor: 1, eatenAt: Date.now() }),
      await call<ApiError>("POST", mealPaths.retract(text.body.capture.id)),
      await call<ApiError>("POST", mealPaths.transcribe(memo.body.capture.id)),
    ];
    for (const r of refused) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("the meal was removed");
    }
    // an upload retried after a lost response is answered with what was stored
    const retried = await call<CaptureResponse>("POST", mealPaths.captures(meal.id), {
      id: "01a00000-0000-7000-8000-0000000000a1",
      kind: "text",
      text: "noch was",
    });
    expect(retried.status).toBe(200);
    // nothing moved: the time, the captures, the revision
    const detail = (await call<MealDetailResponse>("GET", mealPaths.meal(meal.id))).body;
    expect(detail.meal).toMatchObject({ eatenAt: meal.eatenAt, currentRevisionId: meal.currentRevisionId });
    expect(detail.captures.filter((c) => c.retractedAt === null)).toHaveLength(3);
    // nor in the database: the triggers refuse what slips past the service
    expect(() =>
      s.repos.captures.insert({
        id: "01a00000-0000-7000-8000-0000000000a2",
        mealId: meal.id,
        kind: "text",
        text: "durch die Hintertür",
        now: Date.now(),
      }),
    ).toThrow("the meal was removed");

    await restore(meal.id);
    expect((await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "mehr" })).status).toBe(
      201,
    );
  });

  test("removal cancels a queued analysis and the transcriptions; the meal stands where the analysis started", async () => {
    // analysed before, queued again: back to its revision
    const meal = await analysed("Abgebrochener Testkuchen");
    await call("POST", mealPaths.captures(meal.id), { kind: "correction", text: "doppelt" });
    expect((await call<AnalyseResponse>("POST", mealPaths.analyse(meal.id))).body.meal.status).toBe("queued");
    const removed = await remove(meal.id);
    expect(removed.body).toMatchObject({ meal: { status: "analysed" }, stoppedAnalysis: true });
    const jobs = (key: string) => s.repos.jobs.list().filter((j) => j.dedupeKey === key);
    expect(jobs(dedupeKeys.analyse(meal.id))).toMatchObject([
      { status: "cancelled", lastError: "the meal was removed" },
    ]);
    expect((await restore(meal.id)).body.meal).toMatchObject({ status: "analysed", removedAt: null });
    expect(s.repos.jobs.hasQueued(dedupeKeys.analyse(meal.id))).toBe(false);

    // a first analysis waiting for a voice memo: back to draft; the memo's transcription comes back
    const draft = await newMeal();
    const memo = await call<CaptureResponse>(
      "POST",
      mealPaths.captures(draft.id),
      upload(new Blob([fakeM4a()], { type: "audio/mp4" }), "memo.m4a"),
    );
    const key = dedupeKeys.transcribe(memo.body.capture.id);
    await call("POST", mealPaths.analyse(draft.id));
    expect((await remove(draft.id)).body).toMatchObject({ meal: { status: "draft" }, stoppedAnalysis: true });
    expect(jobs(key)).toMatchObject([{ status: "cancelled" }]);
    expect((await restore(draft.id)).body.meal).toMatchObject({ status: "draft", removedAt: null });
    expect(jobs(key).map((j) => j.status)).toEqual(["cancelled", "queued"]);
    expect(s.repos.transcripts.get(memo.body.capture.id)?.status).toBe("pending");
    // restored twice: still one queued transcription
    await remove(draft.id);
    await restore(draft.id);
    await restore(draft.id);
    expect(jobs(key).filter((j) => j.status === "queued")).toHaveLength(1);
  });

  test("a failed meal stays failed with its error while removed and after", async () => {
    const meal = await newMeal();
    await call("POST", mealPaths.captures(meal.id), { kind: "text", text: "kaputt" });
    s.repos.meals.setStatus(meal.id, "failed", Date.now(), "the agent crashed");
    expect((await remove(meal.id)).body.meal).toMatchObject({
      status: "failed",
      analysisError: "the agent crashed",
    });
    expect((await restore(meal.id)).body.meal).toMatchObject({
      status: "failed",
      analysisError: "the agent crashed",
    });
  });

  test("remove and restore need the identity and our origin", async () => {
    const meal = await newMeal();
    const anonymous = { method: "POST", headers: { origin: AUTH.origin } };
    expect((await fetch(url(mealPaths.remove(meal.id)), anonymous)).status).toBe(401);
    expect((await fetch(url(mealPaths.restore(meal.id)), anonymous)).status).toBe(401);
    const cross = await call("POST", mealPaths.remove(meal.id), undefined, {
      origin: "https://evil.example",
    });
    expect(cross.status).toBe(403);
    const crossRestore = await call("POST", mealPaths.restore(meal.id), undefined, {
      origin: "https://evil.example",
    });
    expect(crossRestore.status).toBe(403);
    expect(s.repos.meals.get(meal.id)?.removedAt).toBeNull();
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
