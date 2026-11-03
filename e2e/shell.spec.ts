import { expect, test } from "@playwright/test";

test("the shell loads on a phone: overview, Log meal, installable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByTestId("today-totals")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log meal" })).toBeVisible();

  // the page fits the phone: no horizontal scrolling
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // home-screen app: manifest, icons, iOS metas, and a service worker for the app shell
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toEqual(["any", "any", "maskable"]);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await page.request.get(touchIcon!)).ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL("/", page.url()).toString());
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
