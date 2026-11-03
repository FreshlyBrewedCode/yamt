import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type MealDetailResponse, mealPaths } from "../packages/shared/src/api-meals.ts";
import { type ShareResponse, sharePaths } from "../packages/shared/src/api-share.ts";

// Paste and the share target (#26). The clipboard is stubbed: `navigator.clipboard.read()` answers
// what `window.__clipboard` says (made-up items: a 1×1 PNG, a link), and the fallback sheet gets
// synthetic paste events. The share endpoint is posted the way the iOS Shortcut does: multipart,
// no Origin header.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PHOTO = Buffer.from(PNG_B64, "base64");
// synthetic speech (see packages/server/test/helpers.ts), as a copied voice memo might arrive
const MEMO_B64 = readFileSync(resolve("packages/server/test/fixtures/memo-de.m4a")).toString("base64");

type ClipboardMode = "items" | "denied";

async function stubClipboard(page: Page) {
  await page.addInitScript((png) => {
    const w = window as unknown as { __clipboard: string };
    w.__clipboard = "items";
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    Object.defineProperty(navigator.clipboard, "read", {
      configurable: true,
      value: async () => {
        if (w.__clipboard === "denied") throw new DOMException("Read permission denied.", "NotAllowedError");
        const link = "https://example.com/rezept/linsen-curry";
        return [
          new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
          new ClipboardItem({
            "text/plain": new Blob([link], { type: "text/plain" }),
            "text/uri-list": new Blob([link], { type: "text/uri-list" }),
          }),
        ];
      },
    });
  }, PNG_B64);
}

const setClipboard = (page: Page, mode: ClipboardMode) =>
  page.evaluate((m) => {
    (window as unknown as { __clipboard: string }).__clipboard = m;
  }, mode);

/** A paste event on the sheet's target, as iOS fires it after "Paste" in its callout. */
const pasteInto = (
  page: Page,
  what: { types?: Record<string, string>; file?: { name: string; type: string; base64: string } },
) =>
  page.getByTestId("paste-target").evaluate((el, w) => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(w.types ?? {})) dt.setData(type, value);
    if (w.file) {
      const bytes = Uint8Array.from(atob(w.file.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], w.file.name, { type: w.file.type }));
    }
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, what);

const mealIdOf = (url: string) => new URL(url).pathname.split("/").pop()!;

test("paste: a screenshot and a link from the clipboard; the fallback sheet for the rest", async ({
  page,
}) => {
  await stubClipboard(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Log meal" }).click();
  const mealId = mealIdOf(page.url());

  // the Paste button: one capture per clipboard item
  await page.getByRole("button", { name: "Paste from the clipboard" }).click();
  await expect(page.locator('[data-testid="capture-row"][data-upload="done"]')).toHaveCount(2, {
    timeout: 15_000,
  });
  const detail = async () =>
    (await (await page.request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  const first = await detail();
  expect(first.captures.map((c) => c.kind)).toEqual(["image", "link"]);
  expect(first.captures[0]?.mimeType).toBe("image/png");
  expect(first.captures[0]?.fileName).toMatch(/^pasted-\d{4}-\d\d-\d\d-\d{4}\.png$/);
  expect(first.captures[1]?.url).toBe("https://example.com/rezept/linsen-curry");

  // reading refused: the sheet to paste into, saying why
  await setClipboard(page, "denied");
  await page.getByRole("button", { name: "Paste from the clipboard" }).click();
  await expect(page.getByRole("heading", { name: "Paste" })).toBeVisible();
  await expect(page.getByTestId("paste-why")).toContainText("Reading the clipboard wasn't allowed.");

  // a paste of nothing usable says what the clipboard had
  await pasteInto(page, { types: { "com.apple.m4a-audio": "x" } });
  await expect(page.getByTestId("paste-nothing")).toContainText("Nothing usable on the clipboard.");
  await expect(page.getByTestId("paste-nothing")).toContainText("It had: com.apple.m4a-audio");

  // a pasted audio file (no type, a Voice Memos name) is a voice memo; the sheet closes
  await pasteInto(page, { file: { name: "New Recording.m4a", type: "", base64: MEMO_B64 } });
  await expect(page.getByTestId("paste-target")).toHaveCount(0);
  await expect(page.locator('[data-testid="capture-row"][data-upload="done"]')).toHaveCount(3, {
    timeout: 15_000,
  });
  const after = await detail();
  expect(after.captures.map((c) => c.kind)).toEqual(["image", "link", "audio"]);
  expect(after.captures[2]).toMatchObject({ fileName: "New Recording.m4a", mimeType: "audio/mp4" });
});

test("share: what the Shortcut posts lands in the current draft, which shows it", async ({
  page,
  request,
}) => {
  const form = new FormData();
  form.append("file", new Blob([PHOTO], { type: "image/png" }), "Screenshot 2026-11-03.png");
  form.append(
    "file",
    new Blob(["https://example.com/rezept/kuerbis-curry"], { type: "text/plain" }),
    "url.txt",
  );
  // no Origin: Shortcuts doesn't send one
  const res = await request.post(sharePaths.share, {
    multipart: form,
    headers: { accept: "application/json" },
  });
  expect(res.status()).toBeLessThan(300);
  const shared = (await res.json()) as ShareResponse;
  expect(shared.captures.map((c) => c.kind)).toEqual(["image", "link"]);
  expect(shared.summary).toMatch(/^Added 1 photo and 1 link to (a new meal|Untitled meal), \d\d:\d\d$/);

  // the next share joins it; without asking for JSON the answer is the summary, for the notification
  const note = new FormData();
  note.append("text", "Dazu ein Glas Wasser");
  const plain = await request.post(sharePaths.share, { multipart: note });
  expect(plain.status()).toBe(200);
  expect(await plain.text()).toMatch(/^Added 1 note to Untitled meal, \d\d:\d\d$/);

  // the meal's URL opens its capture view: the shared items come last (an earlier spec's draft
  // from this run may still be the current one, which is the rule)
  const meal = (await (await request.get(mealPaths.meal(shared.meal.id))).json()) as MealDetailResponse;
  const n = meal.captures.length;
  expect(meal.captures.slice(-3).map((c) => c.kind)).toEqual(["image", "link", "text"]);
  await page.goto(new URL(shared.url).pathname);
  await expect(page.getByTestId("meal-title")).toHaveText("Untitled meal");
  const rows = page.getByTestId("capture-row");
  await expect(rows).toHaveCount(n);
  await expect(rows.nth(n - 3)).toHaveAttribute("data-kind", "image");
  await expect(rows.nth(n - 2)).toHaveAttribute("data-kind", "link");
  await expect(rows.nth(n - 2)).toContainText("example.com/rezept/kuerbis-curry");
  await expect(rows.nth(n - 1)).toContainText("Dazu ein Glas Wasser");
  await expect(page.getByRole("button", { name: "Analyse" })).toBeEnabled();
});
