import { expect, test } from "@playwright/test";

test("the shell loads on a phone and reaches the API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "yamt" })).toBeVisible();
  await expect(page.getByTestId("server-status")).toHaveText("Server online");
  await expect(page.getByRole("button", { name: "Log meal" })).toBeVisible();

  // the page fits the phone: no horizontal scrolling
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("client routes fall back to the shell", async ({ page }) => {
  const res = await page.goto("/some/deep/link");
  expect(res?.status()).toBe(200);
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("health and /api/me answer (the identity check is bypassed with --no-auth)", async ({ request }) => {
  expect((await request.get("/api/health")).ok()).toBe(true);
  expect(await (await request.get("/api/me")).json()).toEqual({ login: "local" });
});
