import { expect, type Page, test } from "@playwright/test";
import { agentPaths } from "../packages/shared/src/api-agent.ts";
import type { MealDetailResponse, MealResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { OWN_ORIGIN } from "./api.ts";

// Settings → Agent (#28) against the fake agent (packages/server/test/fake-agent.ts), which the
// e2e server runs as the custom harness fixed by YAMT_ANALYSIS_HARNESS (playwright.config.ts): it
// advertises Fake Fast (efforts low/high), Fake Smart (low/medium/high/max) and Fake Tiny (none).
// No real harness is ever started: the harness choice is fixed, so Claude Code can't be picked.

const section = (page: Page) => page.getByTestId("agent-settings");
const chip = (page: Page, name: string) =>
  section(page).getByTestId("agent-effort").getByRole("button", { name, exact: true });

test.afterAll(async ({ request }) => {
  // leave the harness's defaults for the other specs
  await request.put(agentPaths.agent, {
    headers: OWN_ORIGIN,
    data: { harness: "custom", model: null, effort: null },
  });
});

test("pick a model and an effort from what the harness offers; the next analysis runs with them", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  const agent = section(page);
  await agent.scrollIntoViewIfNeeded();

  // the harness: fixed by the env, so every row is disabled and the custom one chosen
  await expect(agent).toContainText("Fixed by YAMT_ANALYSIS_HARNESS");
  const custom = agent.getByTestId("agent-harness").locator('[data-kind="custom"]');
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  await expect(custom).toBeDisabled();
  await expect(custom).toContainText("fake-agent 1.0.0");
  await expect(agent.getByTestId("agent-harness").locator('[data-kind="claude-code"]')).toBeDisabled();

  // the harness's own default model and its efforts, read from the harness
  const model = agent.getByTestId("agent-model");
  await expect(model).toContainText("Fake Fast");
  await expect(model).toContainText("Custom agent's own default");
  await expect(chip(page, "Low")).toHaveAttribute("aria-pressed", "true");
  await expect(agent.getByTestId("agent-effort").getByRole("button")).toHaveCount(2);

  // another model from the picker, by its label: the efforts follow it
  await model.click();
  const list = page.getByTestId("model-list");
  await expect(list.getByRole("button")).toHaveCount(3);
  await list.locator('[data-value="fake-smart"]').click();
  await expect(model).toContainText("Fake Smart");
  await expect(model).toContainText("Thinks harder");
  await expect(agent.getByTestId("agent-effort").getByRole("button")).toHaveCount(4);
  await expect(chip(page, "Medium")).toHaveAttribute("aria-pressed", "true");

  await chip(page, "Max").click();
  await expect(chip(page, "Max")).toHaveAttribute("aria-pressed", "true");
  expect(await (await request.get(agentPaths.agent)).json()).toMatchObject({
    model: { value: "fake-smart", source: "app" },
    effort: { value: "max", source: "app" },
  });

  // the next analysis: the trace header names what was asked for and what ran
  const { meal } = (await (
    await request.post(mealPaths.meals, { headers: OWN_ORIGIN, data: {} })
  ).json()) as MealResponse;
  await request.post(mealPaths.captures(meal.id), {
    headers: OWN_ORIGIN,
    data: { kind: "text", text: "Brot mit Käse, fake:save" },
  });
  await request.post(mealPaths.analyse(meal.id), { headers: OWN_ORIGIN, data: {} });
  await expect
    .poll(
      async () =>
        ((await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse).meal.status,
      { timeout: 20_000 },
    )
    .toBe("analysed");
  await page.goto(`/meals/${meal.id}`);
  await page.getByRole("button", { name: /^Trace/ }).click();
  const trace = page.getByTestId("trace").first();
  await expect(trace).toContainText("fake-smart-answered");
  await expect(trace).toContainText("Asked for");
  await expect(trace).toContainText("max");
  await expect(trace).toContainText("effort set to max");

  // a model without an effort setting
  await page.goto("/settings");
  await section(page).getByTestId("agent-model").click();
  await page.getByTestId("model-list").locator('[data-value="fake-tiny"]').click();
  await expect(section(page).getByTestId("agent-no-effort")).toHaveText("Fake Tiny has no effort setting.");
  // the saved effort (max) wasn't offered by the new model, so it was dropped
  expect(await (await request.get(agentPaths.agent)).json()).toMatchObject({
    model: { value: "fake-tiny", source: "app" },
    effort: { value: null, source: "default" },
  });
});
