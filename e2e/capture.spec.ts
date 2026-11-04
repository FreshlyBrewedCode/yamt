import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type MealDetailResponse, mealPaths } from "../packages/shared/src/api-meals.ts";

// The capture flow on the phone: Log meal → record (Chromium's fake microphone, a made-up tone,
// see playwright.config.ts) → photos, a note, a link → Analyse → the overview follows the meal
// until the fake agent has analysed it. Photos are made up: a 1×1 PNG without EXIF (so the meal
// stays today), and the test gradient (EXIF 30 Oct 2026, which moves its meal to that day).
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const EXIF_PHOTO = readFileSync(resolve("packages/server/test/fixtures/gradient.jpg"));

const mealIdOf = (url: string) => new URL(url).pathname.split("/").pop()!;

test("log a meal: record, photos, note, link, analyse", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Log meal" }).click();
  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}\?new=/);
  await expect(page.getByTestId("meal-title")).toHaveText("Log meal");
  const mealId = mealIdOf(page.url());
  // nothing exists on the server until the first capture is up
  expect((await page.request.get(mealPaths.meal(mealId))).status()).toBe(404);

  // record ~2 s
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("recording-time")).toHaveText("0:02", { timeout: 10_000 });
  await expect(page.getByRole("img", { name: "Input level" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyse" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator('[data-testid="capture-row"][data-kind="audio"]')).toHaveCount(1);

  // two photos at once
  await page.getByTestId("photo-input").setInputFiles([
    { name: "IMG_0001.png", mimeType: "image/png", buffer: PHOTO },
    { name: "IMG_0002.png", mimeType: "image/png", buffer: PHOTO },
  ]);

  // a note and a link (a bare host gets https://)
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Dazu ein Glas Apfelschorle");
  await page.getByRole("button", { name: "Add note" }).last().click();
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("example.com/rezept/kuerbis-curry");
  await page.getByRole("button", { name: "Add link" }).last().click();

  const rows = page.getByTestId("capture-row");
  await expect(rows).toHaveCount(5);
  await expect(page.locator('[data-testid="capture-row"][data-upload="done"]')).toHaveCount(5, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("meal-title")).toHaveText("Untitled meal");

  const detail = (await (await page.request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.captures.map((c) => c.kind)).toEqual(["audio", "image", "image", "text", "link"]);
  expect(detail.captures[0]?.mimeType).toMatch(/^audio\//);
  expect(detail.captures[0]?.capturedAt).toBeGreaterThan(0);
  expect(detail.captures[4]?.url).toBe("https://example.com/rezept/kuerbis-curry");

  // the recording plays back from the server
  await expect(rows.first()).toHaveAttribute("data-kind", "audio");

  // analyse: back to the overview, which follows the meal until it is analysed
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page).toHaveURL(/\/$/);
  const row = page.locator(`[data-testid="meal-row"][data-meal-id="${mealId}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "analysed", { timeout: 25_000 });
  // the fake agent's revision: "Testessen", 250 g at 200 kcal/100 g
  await expect(row).toContainText("Testessen");
  await expect(row).toContainText("500");
  await expect(page.getByTestId("today-totals").getByTestId("kcal")).not.toHaveText("—");

  // opening it again: its detail with the numbers; adding more goes to the capture view, which
  // offers Re-analyse once something new is there
  await row.click();
  await expect(page.getByTestId("meal-totals")).toContainText("500");
  await page.getByRole("button", { name: "Add more" }).click();
  await expect(page).toHaveURL(/\?add=/);
  await expect(page.getByRole("button", { name: "Re-analyse" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("ohne Zucker");
  await page.getByRole("button", { name: "Add note" }).last().click();
  await expect(page.getByRole("button", { name: "Re-analyse" })).toBeEnabled();
});

test("offline: captures wait on the phone, survive a reload, and go up when the network is back", async ({
  page,
  context,
}) => {
  await page.goto("/");
  // the service worker has the app shell, so the app opens without a network
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("button", { name: "Log meal" }).click();
  const mealId = mealIdOf(page.url());

  await context.setOffline(true);
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Brezel mit Butter");
  await page.getByRole("button", { name: "Add note" }).last().click();
  await page
    .getByTestId("photo-input")
    .setInputFiles({ name: "IMG_0003.jpg", mimeType: "image/jpeg", buffer: EXIF_PHOTO });
  await expect(page.getByTestId("capture-status")).toHaveText(["Waiting for network", "Waiting for network"]);
  // Analyse while offline is accepted and waits
  await page.getByRole("button", { name: "Analyse" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/meals/${mealId}`);
  await expect(page.getByRole("button", { name: "Analyse queued" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("2 uploads");

  // the overview lists the meal that so far exists only on this phone
  await page.goto("/");
  const row = page.locator(`[data-testid="meal-row"][data-meal-id="${mealId}"]`);
  await expect(row).toContainText("2 uploading");

  await context.setOffline(false);
  // the uploads go up, then the analysis runs (the fake agent)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "analysed", { timeout: 25_000 });
  const detail = (await (await page.request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.captures.map((c) => c.kind)).toEqual(["text", "image"]);
  expect(detail.captures.filter((c) => c.retractedAt === null)).toHaveLength(2);
});

test("a capture can be retracted", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Log meal" }).click();
  const mealId = mealIdOf(page.url());
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Versehen");
  await page.getByRole("button", { name: "Add note" }).last().click();
  const row = page.locator('[data-testid="capture-row"][data-upload="done"]');
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Remove capture" }).click();
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("capture-row")).toHaveCount(0);
  const detail = (await (await page.request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.captures[0]?.retractedAt).not.toBeNull();
});
