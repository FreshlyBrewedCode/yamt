import { type APIRequestContext, expect, test } from "@playwright/test";
import type { MealDetailResponse, MealResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { OWN_ORIGIN } from "./api.ts";

// Removing a meal (soft): the detail's "Remove meal" row asks once, removes it and opens its
// day, which offers Undo; a removed meal opened directly offers Restore. The meal is analysed by
// the fake agent (`fake:save`: "Testessen", 500 kcal).

async function analysedMeal(request: APIRequestContext): Promise<string> {
  const { meal } = (await (
    await request.post(mealPaths.meals, { headers: OWN_ORIGIN, data: {} })
  ).json()) as MealResponse;
  await request.post(mealPaths.captures(meal.id), {
    headers: OWN_ORIGIN,
    data: { kind: "text", text: "Testessen zum Entfernen, fake:save" },
  });
  expect((await request.post(mealPaths.analyse(meal.id), { headers: OWN_ORIGIN, data: {} })).ok()).toBe(true);
  await expect
    .poll(async () => (await detailOf(request, meal.id)).meal.status, { timeout: 20_000 })
    .toBe("analysed");
  return meal.id;
}

const detailOf = async (request: APIRequestContext, id: string) =>
  (await (await request.get(mealPaths.meal(id))).json()) as MealDetailResponse;

test("remove a meal from its detail: confirm, land on its day without it, undo brings it back", async ({
  page,
  request,
}) => {
  const mealId = await analysedMeal(request);
  await page.goto(`/meals/${mealId}`);
  await expect(page.getByTestId("meal-title")).toHaveText("Testessen");

  // asks once, inline
  const row = page.getByTestId("remove-meal");
  await row.getByRole("button", { name: "Remove meal" }).click();
  await expect(row).toContainText("Remove meal?");
  await row.getByTestId("remove-meal-confirm").click();

  // its day, without it, and the strip that offers Undo
  await expect(page).toHaveURL(new RegExp(`/days/\\d{4}-\\d{2}-\\d{2}\\?removed=${mealId}$`));
  const strip = page.getByTestId("removed-strip");
  await expect(strip).toContainText("Meal removed");
  await expect(strip).toContainText("Testessen");
  const mealRow = page.locator(`[data-meal-id="${mealId}"]`);
  await expect(page.getByTestId("day-title")).toBeVisible();
  await expect(mealRow).toHaveCount(0);
  expect((await detailOf(request, mealId)).meal.removedAt).toEqual(expect.any(Number));

  await strip.getByRole("button", { name: "Undo" }).click();
  await expect(strip).toHaveCount(0);
  await expect(mealRow).toBeVisible();
  await expect(page).not.toHaveURL(/removed=/);
  expect((await detailOf(request, mealId)).meal).toMatchObject({ removedAt: null, status: "analysed" });
});

test("a removed meal opened directly says so and can be restored", async ({ page, request }) => {
  const mealId = await analysedMeal(request);
  expect((await request.post(mealPaths.remove(mealId), { headers: OWN_ORIGIN })).ok()).toBe(true);
  await page.goto(`/meals/${mealId}`);
  await expect(page.getByTestId("removed-chip")).toHaveText("Removed");
  await expect(page.getByTestId("removed-meal")).toContainText("isn't counted");
  await expect(page.getByTestId("meal-totals")).toContainText("not counted");
  await expect(page.getByTestId("remove-meal")).toHaveCount(0);

  await page.getByTestId("restore-meal").click();
  await expect(page.getByTestId("removed-meal")).toHaveCount(0);
  await expect(page.getByTestId("detail-slab")).toHaveText(/Add more/);
  await expect(page.getByTestId("remove-meal")).toBeVisible();
  expect((await detailOf(request, mealId)).meal.removedAt).toBeNull();
});
