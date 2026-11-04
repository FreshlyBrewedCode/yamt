import { beforeEach, describe, expect, test } from "bun:test";
import { newId, openDb } from "../src/db/index.ts";
import { createRepos, type Repos } from "../src/db/repos/index.ts";

let repos: Repos;
beforeEach(() => {
  repos = createRepos(openDb(":memory:"));
});

const T0 = 1_800_000_000_000;
const MIN = 60_000;

const text = (mealId: string, at: number, extra: { capturedAt?: number; takenAt?: number } = {}) =>
  repos.captures.insert({ id: newId(), mealId, kind: "text", text: "made-up note", now: at, ...extra });

describe("meals", () => {
  test("a new meal is a draft eaten when it was created, until captures say otherwise", () => {
    const meal = repos.meals.insert({ now: T0 });
    expect(meal).toMatchObject({
      status: "draft",
      eatenAt: T0,
      eatenAtSource: "created",
      currentRevisionId: null,
      createdAt: T0,
    });
  });

  test("eatenAt follows the earliest live capture, preferring EXIF over client over arrival time", () => {
    const meal = repos.meals.insert({ now: T0 });
    text(meal.id, T0 + 5 * MIN);
    expect(repos.meals.capturesChanged(meal.id, T0 + 5 * MIN)).toMatchObject({
      eatenAt: T0 + 5 * MIN,
      eatenAtSource: "capture",
      updatedAt: T0 + 5 * MIN,
    });
    const photo = text(meal.id, T0 + 6 * MIN, { capturedAt: T0 + 6 * MIN, takenAt: T0 - 30 * MIN });
    expect(repos.meals.capturesChanged(meal.id)?.eatenAt).toBe(T0 - 30 * MIN);
    text(meal.id, T0 + 7 * MIN, { capturedAt: T0 + 2 * MIN });
    expect(repos.meals.capturesChanged(meal.id)?.eatenAt).toBe(T0 - 30 * MIN);

    // retracting the old photo moves it back
    repos.captures.retract(photo.id);
    expect(repos.meals.capturesChanged(meal.id)?.eatenAt).toBe(T0 + 2 * MIN);
  });

  test("with every capture retracted the meal falls back to its creation time", () => {
    const meal = repos.meals.insert({ now: T0 });
    const c = text(meal.id, T0 + MIN);
    repos.captures.retract(c.id);
    expect(repos.meals.capturesChanged(meal.id)).toMatchObject({ eatenAt: T0, eatenAtSource: "created" });
  });

  test("a pinned time (user, agent) is not moved by captures", () => {
    const meal = repos.meals.insert({ eatenAt: T0 - 60 * MIN, now: T0 });
    expect(meal.eatenAtSource).toBe("user");
    text(meal.id, T0 + MIN);
    expect(repos.meals.capturesChanged(meal.id)?.eatenAt).toBe(T0 - 60 * MIN);
    repos.meals.setEatenAt(meal.id, T0 - 45 * MIN, "agent");
    text(meal.id, T0 + 2 * MIN, { takenAt: T0 - 90 * MIN });
    expect(repos.meals.capturesChanged(meal.id)).toMatchObject({
      eatenAt: T0 - 45 * MIN,
      eatenAtSource: "agent",
    });
  });

  test("list: eaten in [from, to), newest first, with live capture counts and a cover photo", () => {
    const breakfast = repos.meals.insert({ eatenAt: T0, now: T0 });
    const lunch = repos.meals.insert({ eatenAt: T0 + 300 * MIN, now: T0 });
    repos.meals.insert({ eatenAt: T0 + 24 * 60 * MIN, now: T0 });
    text(lunch.id, T0);
    const gone = text(lunch.id, T0 + 1);
    repos.captures.retract(gone.id);
    const photo = repos.captures.insert({ id: newId(), mealId: lunch.id, kind: "image", now: T0 + 2 });
    repos.captures.insert({ id: newId(), mealId: lunch.id, kind: "image", now: T0 + 3 });

    const meals = repos.meals.list({ from: T0, to: T0 + 24 * 60 * MIN, limit: 10 });
    expect(meals.map((m) => m.id)).toEqual([lunch.id, breakfast.id]);
    expect(meals[0]).toMatchObject({
      captureCount: 3,
      captureKinds: { text: 1, image: 2 },
      coverCaptureId: photo.id,
    });
    expect(meals[1]).toMatchObject({ captureCount: 0, captureKinds: {}, coverCaptureId: null });
    expect(repos.meals.list({ limit: 1 })).toHaveLength(1);
  });
});

describe("captures", () => {
  test("insert and read back every field", () => {
    const meal = repos.meals.insert();
    const id = newId();
    const c = repos.captures.insert({
      id,
      mealId: meal.id,
      kind: "image",
      capturedAt: T0,
      takenAt: T0 - 1,
      media: {
        mimeType: "image/heic",
        path: "media/2027/01/x.heic",
        byteSize: 3,
        sha256: "abc",
        fileName: "IMG_0001.HEIC",
        jpeg: { status: "ok", path: "media/2027/01/x.jpg" },
      },
      now: T0 + 1,
    });
    expect(c).toMatchObject({
      id,
      mealId: meal.id,
      kind: "image",
      createdAt: T0 + 1,
      capturedAt: T0,
      takenAt: T0 - 1,
      mimeType: "image/heic",
      byteSize: 3,
      sha256: "abc",
      fileName: "IMG_0001.HEIC",
      jpegDerivative: "ok",
      mediaPath: "media/2027/01/x.heic",
      jpegPath: "media/2027/01/x.jpg",
      retractedAt: null,
    });
  });

  test("retract sets the time once; listing keeps retracted captures in arrival order", () => {
    const meal = repos.meals.insert();
    const a = text(meal.id, T0);
    const b = text(meal.id, T0 + 1);
    expect(repos.captures.retract(a.id, T0 + 10)?.retractedAt).toBe(T0 + 10);
    expect(repos.captures.retract(a.id, T0 + 20)?.retractedAt).toBe(T0 + 10);
    expect(repos.captures.listForMeal(meal.id).map((c) => c.id)).toEqual([a.id, b.id]);
    expect(repos.captures.countLive(meal.id)).toBe(1);
  });

  test("the database refuses edits, a second retraction and deletes", () => {
    const meal = repos.meals.insert();
    const c = text(meal.id, T0);
    const db = repos.db;
    expect(() => db.run("UPDATE captures SET text = 'edited' WHERE id = ?", [c.id])).toThrow("immutable");
    expect(() => db.run("UPDATE captures SET meal_id = 'other' WHERE id = ?", [c.id])).toThrow("immutable");
    expect(() => db.run("DELETE FROM captures WHERE id = ?", [c.id])).toThrow("never deleted");
    db.run("UPDATE captures SET retracted_at = 1 WHERE id = ?", [c.id]);
    expect(() => db.run("UPDATE captures SET retracted_at = NULL WHERE id = ?", [c.id])).toThrow(
      "already retracted",
    );
    expect(() => db.run("DELETE FROM meals WHERE id = ?", [meal.id])).toThrow();
  });

  test("a capture needs an existing meal", () => {
    expect(() => text("no-such-meal", T0)).toThrow();
  });
});

describe("transcripts", () => {
  test("pending → done, failed, and reset to pending for a new run", () => {
    const meal = repos.meals.insert();
    const audio = repos.captures.insert({ id: newId(), mealId: meal.id, kind: "audio" });
    expect(repos.transcripts.upsertPending(audio.id, T0)).toMatchObject({ status: "pending", text: null });
    const segments = [{ startMs: 0, endMs: 1200, text: "Zwei Scheiben Brot" }];
    expect(
      repos.transcripts.complete(audio.id, {
        text: "Zwei Scheiben Brot",
        model: "test-model",
        language: "de",
        durationMs: 1200,
        segments,
      }),
    ).toMatchObject({ status: "done", text: "Zwei Scheiben Brot", language: "de", segments });
    expect(repos.transcripts.listForMeal(meal.id)).toHaveLength(1);
    expect(repos.transcripts.upsertPending(audio.id, T0 + 1)).toMatchObject({
      status: "pending",
      text: null,
      segments: null,
      createdAt: T0,
      updatedAt: T0 + 1,
    });
    expect(repos.transcripts.fail(audio.id, "decoder crashed")).toMatchObject({
      status: "failed",
      error: "decoder crashed",
    });
  });
});

describe("weight", () => {
  test("insert, list a range newest first, delete", () => {
    const a = repos.weight.insert({ measuredAt: T0, kg: 80.4, note: "" });
    const b = repos.weight.insert({ measuredAt: T0 + 86_400_000, kg: 80.1, note: "after run" });
    expect(b).toMatchObject({ kg: 80.1, note: "after run", source: "manual" });
    expect(repos.weight.list({ limit: 10 }).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(repos.weight.list({ from: T0 + 1, limit: 10 }).map((e) => e.id)).toEqual([b.id]);
    expect(repos.weight.delete(a.id)).toBe(true);
    expect(repos.weight.delete(a.id)).toBe(false);
  });
});
