import { expect, type Page, test } from "@playwright/test";
import type { AgentResponse } from "../packages/shared/src/api-agent.ts";
import { agentPaths } from "../packages/shared/src/api-agent.ts";
import type { PlanningRequestResponse } from "../packages/shared/src/api-planning-requests.ts";
import { planningRequestPaths } from "../packages/shared/src/api-planning-requests.ts";
import {
  DEFAULT_PLANNING_SETTINGS,
  type PlanningSettingsResponse,
  planningSettingsPaths,
} from "../packages/shared/src/api-planning-settings.ts";
import { OWN_ORIGIN } from "./api.ts";

// Settings → Planning (#46): the planning line under Settings → Agent (against the fake agent,
// fixed as the custom harness by YAMT_PLANNING_HARNESS, see playwright.config.ts) and the
// Planning section's defaults and preferences, applied to a new request's filters.

const planningAgent = (page: Page) => page.getByTestId("planning-agent-settings");
const planningSettings = (page: Page) => page.getByTestId("planning-settings");

test.afterAll(async ({ request }) => {
  // leave the harness's defaults, and the planning settings, for other specs
  await request.put(agentPaths.planningAgent, {
    headers: OWN_ORIGIN,
    data: { harness: "custom", model: null, effort: null },
  });
  await request.put(planningSettingsPaths.settings, { headers: OWN_ORIGIN, data: DEFAULT_PLANNING_SETTINGS });
});

test("the planning agent line: a model and effort from the fake harness, saved under its own key", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  const planning = planningAgent(page);
  await planning.scrollIntoViewIfNeeded();

  // the harness: fixed by YAMT_PLANNING_HARNESS, same as the analysis's
  await expect(planning).toContainText("Fixed by YAMT_PLANNING_HARNESS");
  const custom = planning.getByTestId("planning-agent-harness").locator('[data-kind="custom"]');
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  await expect(custom).toBeDisabled();

  await planning.getByTestId("planning-agent-model").click();
  await page.getByTestId("model-list").locator('[data-value="fake-smart"]').click();
  await expect(planning.getByTestId("planning-agent-model")).toContainText("Fake Smart");
  const max = planning.getByTestId("planning-agent-effort").getByRole("button", { name: "Max", exact: true });
  await max.click();
  await expect(max).toHaveAttribute("aria-pressed", "true");

  const r = (await (await request.get(agentPaths.agent)).json()) as AgentResponse;
  expect(r.planning).toMatchObject({
    model: { value: "fake-smart", source: "app" },
    effort: { value: "max", source: "app" },
  });
  // the analysis setting, a different key, is untouched
  expect(r.model.source).not.toBe("app");
});

test("change the default count, source and portions, and set a preference; a new request picks them up", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  const planning = planningSettings(page);
  await planning.scrollIntoViewIfNeeded();

  const counts = planning.getByRole("group", { name: "Suggestions per round" });
  // 3 → 5
  await counts.getByRole("button", { name: "More: Suggestions per round" }).click();
  await counts.getByRole("button", { name: "More: Suggestions per round" }).click();
  await expect(counts.getByTestId("stepper-value")).toHaveText(/5$/);

  await planning.getByTestId("planning-source-mode").locator('[data-value="published"]').click();

  const portions = planning.getByRole("group", { name: "Portions to cook" });
  // 1 → 2
  await portions.getByRole("button", { name: "More: Portions to cook" }).click();
  await expect(portions.getByTestId("stepper-value")).toHaveText(/2$/);

  await planning.getByTestId("planning-pref-neverEat").click();
  await page.getByRole("textbox", { name: "Never eat", exact: true }).fill("Erdnüsse");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(planning.getByTestId("planning-pref-neverEat")).toContainText("Erdnüsse");

  await expect
    .poll(async () => {
      const r = (await (
        await request.get(planningSettingsPaths.settings)
      ).json()) as PlanningSettingsResponse;
      return r.settings;
    })
    .toMatchObject({
      count: 5,
      sourceMode: "published",
      portionsCooked: 2,
      preferences: { neverEat: ["Erdnüsse"] },
    });

  const res = await request.post(planningRequestPaths.requests, {
    headers: OWN_ORIGIN,
    data: { text: "Etwas zum Abendessen" },
  });
  const { request: created } = (await res.json()) as PlanningRequestResponse;
  expect(created.filters).toMatchObject({ count: 5, sourceMode: "published", portionsCooked: 2 });
});
