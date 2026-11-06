import { expect, test } from "@playwright/test";
import { planningPaths } from "../packages/shared/src/api-planning.ts";
import type { NightlyResponse } from "../packages/shared/src/api-planning-nightly.ts";
import { planningNightlyPaths } from "../packages/shared/src/api-planning-nightly.ts";
import {
  type PlanningRequestDetail,
  planningRequestPaths,
} from "../packages/shared/src/api-planning-requests.ts";
import {
  DEFAULT_PLANNING_SETTINGS,
  type PlanningSettingsResponse,
  planningSettingsPaths,
} from "../packages/shared/src/api-planning-settings.ts";
import { OWN_ORIGIN } from "./api.ts";

// The nightly run (#48): turned on in Settings → Planning, the entry screen's Tonight section runs
// it now (Suggest now, then Regenerate: the earlier suggestions stay quiet until the new ones are
// there), a pick from it, the agent's starters first among the starters, and the overview's quiet
// row. The round runs on the fake agent (the e2e server's custom planning harness; nightly rounds
// slowed by FAKE_ACP_NIGHTLY, see playwright.config.ts), never by waiting for the clock.

const nightly = async (request: import("@playwright/test").APIRequestContext) =>
  (await (await request.get(planningNightlyPaths.nightly)).json()) as NightlyResponse;

/** The nightly requests this spec made, archived ones included. */
const made = new Set<string>();

test.afterAll(async ({ request }) => {
  // leave no nightly request, pick or setting behind for the other specs
  for (const d of (await nightly(request)).requests) made.add(d.request.id);
  for (const id of made) {
    const d = (await (await request.get(planningRequestPaths.request(id))).json()) as PlanningRequestDetail;
    for (const s of d.rounds.flatMap((r) => r.suggestions)) {
      if (s.plannedMealId)
        await request.delete(planningPaths.plannedMeal(s.plannedMealId), { headers: OWN_ORIGIN });
    }
    await request.post(planningRequestPaths.archive(id), { headers: OWN_ORIGIN });
  }
  await request.put(planningSettingsPaths.settings, { headers: OWN_ORIGIN, data: DEFAULT_PLANNING_SETTINGS });
});

test("on in the settings → suggest now → pick → regenerate (the earlier stay) → starters → the overview", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // off: the entry screen says so and points at the settings
  await page.goto("/plan");
  await expect(page.getByTestId("nightly-off")).toContainText("Nightly suggestions for today are off.");

  // Settings → Planning: on, 2 a night; the time stays 03:00
  await page.goto("/settings");
  const box = page.getByTestId("planning-nightly");
  await box.scrollIntoViewIfNeeded();
  const toggle = box.getByTestId("nightly-switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(box.getByTestId("nightly-time")).toContainText("03:00");
  await box.getByRole("button", { name: "Fewer: Nightly suggestions" }).click();
  await expect(box.getByTestId("stepper-value")).toContainText("2");
  await expect
    .poll(
      async () =>
        ((await (await request.get(planningSettingsPaths.settings)).json()) as PlanningSettingsResponse)
          .settings.nightly,
    )
    .toEqual({ enabled: true, time: "03:00", count: 2 });
  const scheduled = await nightly(request);
  expect(scheduled.nextRunAt).not.toBeNull();
  expect(new Date(scheduled.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

  // the entry screen: nothing made yet today, so when it arrives and Suggest now
  await page.goto("/plan");
  const section = page.getByTestId("nightly");
  await expect(section).toContainText("arrive at");
  await section.getByTestId("nightly-regenerate").click();
  await expect(section).toHaveAttribute("data-mode", "suggesting", { timeout: 10_000 });
  const ready = section.locator('[data-testid="nightly-suggestion"][data-state="ready"]');
  await expect(ready).toHaveCount(2, { timeout: 40_000 });
  await expect(section).toHaveAttribute("data-mode", "ready");
  await expect(section.locator("h2")).toHaveText(/^(Tonight|Today)$/);
  const first = (await nightly(request)).requests[0]!;
  expect(first.request.origin).toBe("nightly");
  made.add(first.request.id);

  // the agent's starters come first, each with a number computed here
  const starters = page.getByTestId("starter");
  await expect(starters.first()).toHaveAttribute("data-by", "agent");
  await expect(page.getByRole("region", { name: "Start from" })).toContainText("ideas from last night");
  const protein = page.locator('[data-testid="starter"][data-starter="protein_gap"][data-by="agent"]');
  await expect(protein).toContainText("High protein tonight");
  // one of a kind the agent wrote isn't repeated by code's
  await expect(page.locator('[data-starter="season"]')).toHaveCount(1);

  // pick the first: it's planned, the band says where
  const pick = ready.first().getByTestId("nightly-pick");
  await expect(pick).toContainText(/Pick · \w/);
  await pick.click();
  await expect(section.locator('[data-testid="nightly-suggestion"][data-state="picked"]')).toHaveCount(1);

  // regenerate: the earlier ones stay, quiet, until the new ones are there
  await section.getByTestId("nightly-regenerate").click();
  await expect(section).toHaveAttribute("data-mode", "regenerating", { timeout: 10_000 });
  await expect(page.getByTestId("nightly-regenerating")).toContainText(
    "These stay until the new ones arrive",
  );
  await expect(section.getByTestId("nightly-pick")).toHaveCount(0);
  await expect(section).toHaveAttribute("data-mode", "ready", { timeout: 40_000 });
  await expect
    .poll(async () => (await nightly(request)).requests.map((d) => d.request.id), { timeout: 20_000 })
    .not.toContain(first.request.id);
  const second = (await nightly(request)).requests[0]!;
  expect(second.request.id).not.toBe(first.request.id);
  made.add(second.request.id);
  // the pick of the earlier stays planned
  const earlier = (await (
    await request.get(planningRequestPaths.request(first.request.id))
  ).json()) as PlanningRequestDetail;
  const picked = earlier.rounds[0]!.suggestions.find((s) => s.verdict === "picked");
  expect(picked?.plannedMealId).toBeTruthy();
  expect(earlier.request.archivedAt).not.toBeNull();

  // the nightly request is a thread like any other
  await section.getByTestId("nightly-thread").click();
  await expect(page).toHaveURL(new RegExp(`/plan/requests/${second.request.id}$`));
  await page.goBack();

  // a starter fills the composer and the filters
  await protein.click();
  await expect(page.getByTestId("composer-field")).toHaveValue("High protein tonight");
  await expect(page.getByTestId("filter-summary")).toContainText("Tonight · Dinner · High protein");

  // the overview: a quiet row of its own, not a request waiting
  await page.goto("/");
  const row = page.locator('[data-testid="planning-row"][data-state="nightly"]');
  await expect(row).toContainText(/(Tonight|Today) · \d suggestions?/);
  await expect(page.locator('[data-testid="planning-row"][data-state="waiting"]')).toHaveCount(0);
  await row.click();
  await expect(page).toHaveURL(/\/plan$/);
});
