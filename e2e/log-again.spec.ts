import { type APIRequestContext, expect, test } from "@playwright/test";
import type { MealDetailResponse, MealResponse, MealsResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { OWN_ORIGIN } from "./api.ts";

// Log a meal again (#30): copy an analysed meal into a new one without another analysis. The
// source is analysed by the fake agent (`fake:save`: "Testessen", one estimated item of 250 g at
// 200 kcal per 100 g, so 500 kcal; 1.5× is 375 g, 750 kcal).

async function analysedMeal(request: APIRequestContext, text: string): Promise<string> {
  const { meal } = (await (
    await request.post(mealPaths.meals, { headers: OWN_ORIGIN, data: {} })
  ).json()) as MealResponse;
  await request.post(mealPaths.captures(meal.id), { headers: OWN_ORIGIN, data: { kind: "text", text } });
  expect((await request.post(mealPaths.analyse(meal.id), { headers: OWN_ORIGIN, data: {} })).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        ((await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse).meal.status,
      { timeout: 20_000 },
    )
    .toBe("analysed");
  return meal.id;
}

const detailOf = async (request: APIRequestContext, id: string) =>
  (await (await request.get(mealPaths.meal(id))).json()) as MealDetailResponse;

test("log again from a meal's detail at 1.5×: a new analysed meal, no analysis, linked to its source", async ({
  page,
  request,
}) => {
  const sourceId = await analysedMeal(request, "Testessen, fake:save");
  await page.goto(`/meals/${sourceId}`);
  await expect(page.getByTestId("meal-totals").getByTestId("kcal")).toHaveText("500");
  await expect(page.getByTestId("detail-slab")).toHaveText(/Add more/);

  await page.getByTestId("log-again-button").click();
  const sheet = page.getByTestId("log-again");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Same/ })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: /More/ }).click();
  await expect(page.getByTestId("log-again-kcal")).toHaveText(/≈ 750/);
  await sheet.getByRole("button", { name: "Log again" }).click();

  // the copy's detail: the scaled numbers at once, its source, no run behind it
  await expect(page).not.toHaveURL(new RegExp(sourceId));
  const copyId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("meal-title")).toHaveText("Testessen");
  await expect(page.getByTestId("meal-totals").getByTestId("kcal")).toHaveText("750");
  await expect(page.getByTestId("assumptions")).toContainText(/Logged again from Testessen \(.+\), × 1\.5/);
  await expect(page.getByTestId("logged-again-from")).toContainText("Logged again from Testessen");
  await expect(page.getByTestId("detail-slab")).toHaveText(/Add more/);
  await page.getByTestId("trace-section").getByRole("button").first().click();
  await expect(page.getByTestId("no-analysis")).toContainText("Nothing was analysed");

  const copy = await detailOf(request, copyId);
  expect(copy.meal).toMatchObject({ status: "analysed", sourceMealId: sourceId, eatenAtSource: "user" });
  expect(copy.revision?.revision).toMatchObject({ kind: "copy", runId: null });
  expect(copy.revision?.items.map((i) => i.grams)).toEqual([375]);
  expect(copy.runs).toEqual([]);

  // the link goes back to the source
  await page.getByTestId("logged-again-from").click();
  await expect(page).toHaveURL(new RegExp(`/meals/${sourceId}$`));
});

test("log again from the Log meal screen: pick a recent meal, change the time; offline it says so", async ({
  page,
  request,
}) => {
  await analysedMeal(request, "Testessen, fake:save");
  await page.goto("/");
  await page.getByRole("button", { name: "Log meal" }).click();
  const again = page.getByTestId("again");
  await expect(again).toBeVisible();
  const row = again.getByTestId("again-row").filter({ hasText: "Testessen" });
  await expect(row).toContainText(/\d+× in 30 days/);
  await row.click();

  const sheet = page.getByTestId("log-again");
  await sheet.getByRole("button", { name: /change time/ }).click();
  const at = new Date(Date.now() - 90 * 60_000);
  at.setSeconds(0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  await sheet
    .getByLabel("Eaten at")
    .fill(
      `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`,
    );

  // no connection: one request, not queued; it fails and says so
  await page.route("**/repeat", (r) => r.abort("internetdisconnected"));
  await sheet.getByRole("button", { name: "Log again" }).click();
  await expect(sheet.getByRole("alert")).toContainText("No connection");
  await page.unroute("**/repeat");

  await sheet.getByRole("button", { name: "Log again" }).click();
  await expect(page).toHaveURL(/\/$/);
  const copies = (
    (await (
      await request.get(`${mealPaths.meals}?from=${at.getTime()}&to=${at.getTime() + 1}`)
    ).json()) as MealsResponse
  ).meals.filter((m) => m.sourceMealId !== null);
  expect(copies).toMatchObject([{ title: "Testessen", eatenAt: at.getTime(), status: "analysed" }]);
  const copyRow = page.locator(`[data-testid="meal-row"][data-meal-id="${copies[0]!.id}"]`);
  await expect(copyRow).toContainText("Logged again");
  await expect(copyRow).toContainText("500");
});
