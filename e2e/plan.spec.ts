import { expect, test } from "@playwright/test";
import type { MealDetailResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import type { PlannedMealResponse } from "../packages/shared/src/api-planning.ts";
import { planningPaths } from "../packages/shared/src/api-planning.ts";
import { callTool } from "./mcp.ts";

// The plan on the phone (#40): a planned meal (seeded through the MCP tools, as a Claude Code
// session would plan it) shows on the overview; "Ate it" with one ingredient switched off and 1.5×
// logs a meal of exactly those items, and the plan shows it logged. Made-up recipe: one portion is
// 200 g at 100 kcal + 100 g at 200 kcal + 50 g Feta at 260 kcal per 100 g (530 kcal); without the
// Feta at 1.5× it is 300 g + 150 g, 600 kcal.

const BASE = `http://localhost:${process.env.YAMT_E2E_PORT ?? 7898}`;
const DATA = process.env.YAMT_E2E_DATA_DIR!;

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const estimate = (energyKcal: number) => ({ energyKcal, protein: 10, fat: 5, carbohydrate: 10, fiber: 2 });

test("ate it from the overview: one ingredient off at 1.5× logs those items; the plan shows it logged", async ({
  page,
  request,
}) => {
  const { recipeId } = await callTool<{ recipeId: string }>(BASE, DATA, "save_recipe", {
    title: "Testcurry vom Plan",
    summary: "Ein erfundenes Rezept",
    sourceMode: "adapted",
    sourceUrl: "https://www.example.com/rezepte/testcurry",
    sourceName: "example.com",
    changes: ["Sahne → Joghurt"],
    servings: 1,
    timeActiveMin: 10,
    timeTotalMin: 20,
    steps: ["Alles schneiden.", "Kochen."],
    items: [
      {
        description: "Testgemüse",
        grams: 200,
        provenance: "estimate",
        confidence: "medium",
        estimatePer100g: estimate(100),
      },
      {
        description: "Testlinsen",
        grams: 100,
        provenance: "estimate",
        confidence: "medium",
        estimatePer100g: estimate(200),
      },
      {
        description: "Feta",
        grams: 50,
        provenance: "estimate",
        confidence: "medium",
        estimatePer100g: estimate(260),
        optional: true,
      },
    ],
  });
  const { plannedMealId } = await callTool<{ plannedMealId: string }>(BASE, DATA, "plan_meal", {
    recipeId,
    date: localDate(),
    slot: "dinner",
    portionsCooked: 2,
  });

  // the overview: a quiet planned row after the eaten meals, the totals say what the day comes to
  await page.goto("/");
  const row = page.getByTestId("planned-row").filter({ hasText: "Testcurry vom Plan" });
  await expect(row).toContainText("Planned · Dinner");
  await expect(row).toContainText("530");
  await expect(page.getByTestId("today-totals").getByTestId("planned-note")).toContainText(
    "1 planned · with it",
  );
  await expect(page.getByTestId("plan-button")).toBeVisible();

  // Ate it: the Feta off, 1.5×; the sheet computes what will be logged
  await row.getByTestId("ate-it-square").click();
  const sheet = page.getByTestId("ate-it");
  await expect(sheet.getByTestId("ate-it-item")).toHaveCount(3);
  await expect(page.getByTestId("ate-it-kcal")).toHaveText(/530/);
  await sheet.getByTestId("ate-it-item").filter({ hasText: "Feta" }).click();
  await expect(sheet.getByTestId("ate-it-item").filter({ hasText: "Feta" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await sheet.getByRole("button", { name: /More/ }).click();
  await expect(page.getByTestId("ate-it-kcal")).toHaveText(/600/);
  await expect(sheet.getByTestId("ate-it-leftover")).toContainText("0.5 portions stay a leftover");
  await sheet.getByRole("button", { name: "Log it" }).click();

  // the new meal: those items, no analysis, from the plan
  await expect(page).toHaveURL(/\/meals\//);
  const mealId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("meal-title")).toHaveText("Testcurry vom Plan");
  await expect(page.getByTestId("meal-totals").getByTestId("kcal")).toHaveText("600");
  await expect(page.getByTestId("from-the-plan")).toContainText("Logged from the plan · Today, dinner");
  const detail = (await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.meal).toMatchObject({ status: "analysed", sourcePlannedMealId: plannedMealId });
  expect(detail.revision?.revision).toMatchObject({ kind: "plan", runId: null });
  expect(detail.revision?.items.map((i) => [i.description, i.grams])).toEqual([
    ["Testgemüse", 300],
    ["Testlinsen", 150],
  ]);
  await page.getByTestId("revisions-section").getByRole("button").first().click();
  await expect(page.getByTestId("revision")).toContainText("logged from the plan");

  const planned = (await (
    await request.get(planningPaths.plannedMeal(plannedMealId))
  ).json()) as PlannedMealResponse;
  expect(planned.plannedMeal).toMatchObject({ status: "logged", loggedMealId: mealId, portionEaten: 1.5 });

  // the overview lists it as a meal from the plan, no longer as planned
  await page.goto("/");
  await expect(page.getByTestId("meal-row").filter({ hasText: "Testcurry vom Plan" })).toContainText(
    "From the plan",
  );
  await expect(page.getByTestId("planned-row")).toHaveCount(0);

  // the plan view (Plan in the bottom slab) shows it logged; its recipe opens to the meal
  await page.getByTestId("plan-button").click();
  await expect(page).toHaveURL(/\/plan\/days$/);
  await expect(page.getByTestId("plan-square")).toHaveCount(7);
  const logged = page.getByTestId("planned-row").filter({ hasText: "Testcurry vom Plan" });
  await expect(logged).toHaveAttribute("data-status", "logged");
  await expect(logged).toContainText("Logged · Dinner");
  await expect(logged).toContainText("600");
  await expect(logged.getByTestId("ate-it-square")).toHaveCount(0);
  await logged.getByRole("link").click();
  await expect(page.getByTestId("recipe-title")).toHaveText("Testcurry vom Plan");
  await expect(page.getByTestId("recipe-source")).toHaveText(/Adapted from example\.com · 1 change/);
  await expect(page.getByTestId("ingredient")).toHaveCount(3);
  await page.getByTestId("open-logged").click();
  await expect(page).toHaveURL(new RegExp(`/meals/${mealId}$`));
});

test("a planned meal of a later day: change its day and portions, skip it and undo the skip", async ({
  page,
}) => {
  const { recipeId } = await callTool<{ recipeId: string }>(BASE, DATA, "save_recipe", {
    title: "Testsuppe für morgen",
    summary: "",
    sourceMode: "composed",
    servings: 2,
    items: [
      {
        description: "Testkürbis",
        grams: 400,
        provenance: "estimate",
        confidence: "medium",
        estimatePer100g: estimate(40),
      },
    ],
  });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { plannedMealId } = await callTool<{ plannedMealId: string }>(BASE, DATA, "plan_meal", {
    recipeId,
    date: localDate(tomorrow),
    slot: "lunch",
  });

  await page.goto(`/planned/${plannedMealId}`);
  await expect(page.getByTestId("planned-when")).toContainText("Planned · Tomorrow, lunch · cook 1, eat 1");
  await expect(page.getByTestId("recipe-source")).toHaveText(/Composed for you/);
  // not due yet: no Ate it, the slab changes the plan
  await expect(page.getByTestId("recipe-ate-it")).toHaveCount(0);
  await page.getByTestId("recipe-change").click();
  const sheet = page.getByTestId("plan-for");
  await sheet.getByRole("button", { name: "Dinner", exact: true }).click();
  await sheet.getByRole("group", { name: "Portions to cook" }).getByRole("button", { name: "2" }).click();
  await sheet.getByRole("button", { name: /^Save · .+ dinner$/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("planned-when")).toContainText("Tomorrow, dinner · cook 2, eat 1");
  await expect(page.getByTestId("leftover")).toContainText("1 portion");
  await expect(page.getByTestId("ingredient")).toContainText("400");

  // skip it, then undo
  await page.getByTestId("change-plan").click();
  await page.getByTestId("skip").click();
  await expect(page.getByTestId("skipped-band")).toBeVisible();
  await page.getByTestId("unskip").click();
  await expect(page.getByTestId("skipped-band")).toHaveCount(0);
  await expect(page.getByTestId("planned-when")).toContainText("Planned · Tomorrow, dinner");

  // unplan: it leaves the plan
  await page.getByTestId("change-plan").click();
  await page.getByTestId("unplan").click();
  await page.getByTestId("unplan-confirm").click();
  await expect(page).toHaveURL(/\/plan\/days$/);
  await expect(page.getByTestId("planned-row").filter({ hasText: "Testsuppe für morgen" })).toHaveCount(0);
});
