import { expect, type Page, test } from "@playwright/test";
import type {
  PlanningRequestDetail,
  PlanningRequestResponse,
} from "../packages/shared/src/api-planning-requests.ts";
import { planningRequestPaths } from "../packages/shared/src/api-planning-requests.ts";
import { OWN_ORIGIN } from "./api.ts";

// The planning screens (#47): a starter fills the composer, the filter page sets the request, the
// composer sends it through the upload queue, the round fills on the fake agent (the e2e server's
// custom planning harness, scripted by the request's last `fake:plan…` text), a pick lands in the
// plan, a steer starts round 2; a request made offline waits on the phone until it can go; and the
// overview folds several requests sharing a state into one row (#54's follow-up).

const dock = (page: Page) => page.getByTestId("dock");
const field = (page: Page) => page.getByTestId("composer-field");

test("starter → filters → suggestions one by one → pick → the plan view → steer → round 2", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("plan-button").click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { name: "What to cook?" })).toBeVisible();

  // a starter fills the composer (the season's is always there)
  await page.locator('[data-starter="season"]').click();
  await expect(field(page)).toHaveValue(/^Something in season: /);
  await field(page).fill("Something in season, quick. fake:plan-slow:4000");
  await expect(page.getByTestId("composer-send")).toBeEnabled();

  // the filter page: tomorrow, free recipes, two per round; the sentence follows
  await page.getByTestId("filter-summary").click();
  await expect(page).toHaveURL(/\/plan\/filters$/);
  const form = page.getByTestId("filter-form");
  await form
    .getByRole("group", { name: "When" })
    .getByRole("button", { name: "Tomorrow", exact: true })
    .click();
  await form.getByRole("group", { name: "Time" }).getByRole("button", { name: "≤ 30 min" }).click();
  await page.getByTestId("filter-source-mode").locator('[data-mode="composed"]').click();
  await form
    .getByRole("group", { name: "Suggestions per round" })
    .getByRole("button", { name: /^2/ })
    .click();
  await expect(page.getByTestId("request-sentence")).toContainText(
    "Dinner tomorrow, ≤ 30 min total. 2 suggestions, free recipes",
  );
  await page.getByTestId("filters-done").click();

  // back on the entry screen: the summary says it, the text is still there
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByTestId("filter-summary")).toContainText(
    "Tomorrow · Dinner · ≤ 30 min · free recipes · 2 ideas",
  );
  await expect(field(page)).toHaveValue("Something in season, quick. fake:plan-slow:4000");
  await dock(page).getByRole("button", { name: "Suggest" }).click();

  // the thread: what was asked, the outline as placeholders, then the suggestions one by one
  await expect(page).toHaveURL(/\/plan\/requests\/[0-9a-f-]+$/);
  const requestId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("you-asked")).toContainText("Something in season, quick.");
  await expect(page.getByTestId("you-asked").getByTestId("asked-filters")).toContainText("free recipes");
  await expect(page.locator('[data-testid="suggestion"][data-state="outlined"]').first()).toBeVisible({
    timeout: 20_000,
  });
  const ready = page.locator('[data-testid="suggestion"][data-state="ready"]');
  await expect(ready).toHaveCount(2, { timeout: 40_000 });
  await expect(page.getByTestId("request-status")).toContainText("Suggested");
  await expect(page.getByTestId("round-meta")).toHaveText("2 suggestions");
  await expect(ready.first()).toContainText("kcal / portion");

  // the overview's Planning strip: suggestions wait (lime)
  await page.goto("/");
  const row = page.locator(`[data-testid="planning-row"][href="/plan/requests/${requestId}"]`);
  await expect(row).toHaveAttribute("data-state", "waiting");
  await expect(row).toContainText("Suggested · 2 for you");
  await row.click();

  // the recipe from a band's title, then Pick on the band: the proposed slot, tomorrow's dinner
  const firstTitle = (await ready.first().getByTestId("suggestion-title").textContent())!;
  await ready.first().getByTestId("suggestion-title").click();
  await expect(page.getByTestId("recipe-title")).toHaveText(firstTitle);
  await expect(page.getByTestId("suggestion-when")).toContainText(
    "Suggestion · round 1 · for Tomorrow, dinner",
  );
  await expect(page.getByTestId("detail-pick")).toContainText("Pick · Tomorrow dinner");
  await page.goBack();
  await page.locator('[data-testid="suggestion"][data-state="ready"]').first().getByTestId("pick").click();
  const picked = page.locator('[data-testid="suggestion"][data-state="picked"]');
  await expect(picked).toContainText("Planned · Tomorrow dinner");
  await expect(page.locator('[data-testid="slot"][data-filled="picked"]')).toHaveCount(1);

  // No folds the other one; Undo brings it back
  await page.locator('[data-testid="suggestion"][data-state="ready"]').getByTestId("reject").click();
  await expect(page.locator('[data-testid="suggestion"][data-state="rejected"]')).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-testid="suggestion"][data-state="ready"]')).toHaveCount(1);

  // it's in the plan view
  await page.getByRole("link", { name: "Plan view" }).click();
  await expect(page).toHaveURL(/\/plan\/days$/);
  await expect(page.getByTestId("planned-row").filter({ hasText: firstTitle }).first()).toBeVisible();
  await page.goBack();

  // steer: a text through the composer starts round 2 with it ("You added")
  await field(page).fill("Weniger Fleisch, bitte. fake:plan");
  await dock(page).getByRole("button", { name: "Steer" }).click();
  await expect(field(page)).toHaveValue("");
  const rounds = page.getByTestId("round");
  await expect(rounds).toHaveCount(2, { timeout: 20_000 });
  await expect(rounds.nth(1)).toContainText("You added");
  await expect(rounds.nth(1)).toContainText("Weniger Fleisch, bitte.");
  await expect(rounds.nth(1)).toHaveAttribute("data-status", "done", { timeout: 40_000 });
  await expect(rounds.nth(1).locator('[data-testid="suggestion"][data-state="ready"]')).toHaveCount(2);

  const detail = (await (
    await request.get(planningRequestPaths.request(requestId))
  ).json()) as PlanningRequestDetail;
  expect(detail.request.filters).toMatchObject({
    slots: ["dinner"],
    sourceMode: "composed",
    count: 2,
    timeCapMin: 30,
  });
  expect(detail.rounds.map((r) => r.kind)).toEqual(["first", "steer"]);
  expect(detail.rounds[0]?.suggestions.filter((s) => s.verdict === "picked")).toHaveLength(1);
});

test("offline: the request waits on the phone, then goes with its inputs and starts", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  // the thread's code is loaded once (offline, the service worker would have it), then the entry
  await page.goto("/plan/requests/00000000-0000-7000-8000-000000000000");
  await expect(page.getByTestId("request-missing")).toContainText("doesn't exist");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "What to cook?" })).toBeVisible();
  await field(page).fill("Etwas mit Linsen, offline gefragt. fake:plan");
  await expect(page.getByTestId("composer-send")).toBeEnabled();
  await context.setOffline(true);
  await dock(page).getByRole("button", { name: "Suggest" }).click();

  // only this phone has it: the thread says so, the overview lists it
  await expect(page).toHaveURL(/\/plan\/requests\/[0-9a-f-]+$/);
  await expect(page.getByTestId("request-status")).toContainText("On this phone");
  await expect(page.getByTestId("request-queued")).toContainText("Kept on this phone");
  await expect(page.getByTestId("you-asked")).toContainText("Etwas mit Linsen, offline gefragt.");

  // back online, it goes out, and the round runs
  await context.setOffline(false);
  await expect(page.getByTestId("request-status")).toContainText(/Suggesting|Suggested/, { timeout: 20_000 });
  await expect(page.locator('[data-testid="suggestion"][data-state="ready"]')).toHaveCount(3, {
    timeout: 40_000,
  });
  await expect(page.getByTestId("you-asked")).toContainText("Etwas mit Linsen, offline gefragt.");
});

test("the overview folds several waiting requests into one compacted row", async ({ page, request }) => {
  test.setTimeout(60_000);
  const make = async (text: string, slots?: string[]) => {
    const res = await request.post(planningRequestPaths.requests, {
      headers: OWN_ORIGIN,
      data: { text, ...(slots ? { filters: { slots } } : {}) },
    });
    const { request: created } = (await res.json()) as PlanningRequestResponse;
    await request.post(planningRequestPaths.suggest(created.id), { headers: OWN_ORIGIN, data: {} });
    return created;
  };
  const a = await make("Fisch, bitte. fake:plan");
  const b = await make("Nudeln, bitte. fake:plan", ["lunch"]);
  expect(a.title).not.toBe(b.title);

  // both rounds finish with suggestions waiting for a verdict: one lime row, not two
  await page.goto("/");
  const row = page.locator('[data-testid="planning-row"][data-state="waiting"]');
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row).toHaveAttribute("data-compact", "true");
  await expect(row).toContainText(/\d+ requests with suggestions/);
  await expect(row).toContainText(a.title);
  await expect(row).toContainText(b.title);

  // it opens the entry screen, where both requests are listed
  await row.click();
  await expect(page).toHaveURL(/\/plan$/);
  const requests = page.getByTestId("requests");
  await expect(requests.getByTestId("request-row").filter({ hasText: a.title }).first()).toBeVisible();
  await expect(requests.getByTestId("request-row").filter({ hasText: b.title }).first()).toBeVisible();
});
