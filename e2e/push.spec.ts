import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import type { MealDetailResponse, MealResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { type PushResponse, pushPaths } from "../packages/shared/src/api-push.ts";
import { OWN_ORIGIN } from "./api.ts";

// Notifications (#13) on the phone: the settings screen in every state Chromium can show. Real
// push delivery is out of scope: Chromium has no push service here, so the browser's
// PushManager is replaced by a fake that makes a real P-256 key pair and an endpoint on
// `push.invalid` (a name that never resolves), kept in localStorage across reloads.

/**
 * Replaces PushManager's subscribe/getSubscription with a fake one, before the app loads, and
 * makes the Notification permission deterministic (starts "default", "granted" once asked).
 * Real headless Chromium is not: `context.grantPermissions(["notifications"])` is honoured by a
 * full browser (e.g. the NixOS chromium used locally) but not by Playwright's own headless
 * Chromium build, which keeps reporting "denied" regardless — so the app's "blocked" state would
 * show up here even though nothing actually blocked it. Stubbing the permission instead of
 * granting it keeps the test's outcome independent of which Chromium build runs it.
 */
async function fakePushManager(page: Page) {
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
    Notification.requestPermission = async () => {
      permission = "granted";
      return permission;
    };
    const KEY = "e2e-push-subscription";
    const b64 = (bytes: ArrayBuffer | Uint8Array) =>
      btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const wrap = (json: { endpoint: string; keys: { p256dh: string; auth: string } }) => ({
      endpoint: json.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true },
      toJSON: () => ({ ...json, expirationTime: null }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.getSubscription = async () => {
      const stored = localStorage.getItem(KEY);
      return (stored ? wrap(JSON.parse(stored)) : null) as unknown as PushSubscription;
    };
    PushManager.prototype.subscribe = async () => {
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ]);
      const json = {
        endpoint: `https://push.invalid/e2e/${crypto.randomUUID()}`,
        keys: {
          p256dh: b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
          auth: b64(crypto.getRandomValues(new Uint8Array(16))),
        },
      };
      localStorage.setItem(KEY, JSON.stringify(json));
      return wrap(json) as unknown as PushSubscription;
    };
  });
}

const state = (page: Page) => page.getByTestId("push-state");
const subscriptions = async (request: APIRequestContext) =>
  ((await (await request.get(pushPaths.push)).json()) as PushResponse).subscriptions;

test("turn notifications on from the overview, pick events, send a test, turn them off", async ({
  page,
  request,
}) => {
  await fakePushManager(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(state(page)).toHaveAttribute("data-state", "off");
  await expect(state(page)).toContainText("Off");

  await page.getByTestId("push-on").click();
  await expect(state(page)).toHaveAttribute("data-state", "on");
  const analysed = page.getByRole("switch", { name: "Analysed" });
  await expect(analysed).toHaveAttribute("aria-checked", "true");
  const [registered] = await subscriptions(request);
  expect(registered?.endpoint).toMatch(/^https:\/\/push\.invalid\/e2e\//);
  expect(registered?.events).toEqual({ analysed: true, needs_input: true, failed: true });

  // a toggle is stored on the server, per subscription
  await analysed.click();
  await expect(analysed).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await subscriptions(request))[0]?.events.analysed).toBe(false);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Analysed" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "Needs input" })).toHaveAttribute("aria-checked", "true");

  // the test notification goes to the push service, which doesn't exist here: the reason shows
  await page.getByTestId("push-test").click();
  await expect(page.getByRole("status")).toContainText("Not sent: push service unreachable");

  await page.getByTestId("push-off").click();
  await expect(state(page)).toHaveAttribute("data-state", "off");
  await expect.poll(() => subscriptions(request)).toEqual([]);
});

test("blocked: notifications denied in the system settings say where to allow them", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await page.goto("/settings");
  await expect(state(page)).toHaveAttribute("data-state", "blocked");
  await expect(page.getByText("Settings → Notifications → yamt")).toBeVisible();
  await expect(page.getByTestId("push-on")).toHaveCount(0);
});

test("not installed: iOS Safari in a tab gets the Add to Home Screen steps", async ({ page }) => {
  await page.addInitScript(() => {
    // what Safari on iOS looks like outside the home-screen app: no PushManager, standalone false
    Reflect.deleteProperty(window, "PushManager");
    Object.defineProperty(navigator, "standalone", { get: () => false });
  });
  await page.goto("/settings");
  await expect(state(page)).toHaveAttribute("data-state", "not-installed");
  await expect(page.getByTestId("install-steps")).toContainText("Add to Home Screen");
  await expect(page.getByTestId("push-on")).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Add yamt to your Home Screen first.");
});

test("a needs-input notification's link opens the meal at its question", async ({ page, request }) => {
  const { meal } = (await (
    await request.post(mealPaths.meals, { headers: OWN_ORIGIN, data: {} })
  ).json()) as MealResponse;
  for (const text of ["Kürbis-Linsen-Curry mit Reis", "fake:meal:question"]) {
    await request.post(mealPaths.captures(meal.id), { headers: OWN_ORIGIN, data: { kind: "text", text } });
  }
  await request.post(mealPaths.analyse(meal.id), { headers: OWN_ORIGIN, data: {} });
  await expect
    .poll(
      async () =>
        ((await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse).meal.status,
      { timeout: 20_000 },
    )
    .toBe("needs_input");

  await page.goto(`/meals/${meal.id}#questions`);
  const questions = page.getByTestId("questions");
  await expect(questions).toContainText("Wie viel Reis war auf dem Teller?");
  await expect
    .poll(() => questions.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBeLessThanOrEqual(1);
});
