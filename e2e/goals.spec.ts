import { type APIRequestContext, expect, test } from "@playwright/test";
import { addDays, goalPaths } from "../packages/shared/src/api-goals.ts";
import type { MealDetailResponse, MealResponse } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { weightPaths } from "../packages/shared/src/api-weight.ts";

// Goals, weight and the day view (#12) on the phone. Made-up numbers throughout. The fake agent's
// default revision (see packages/server/test/fake-agent.ts) is 250 g at 200 kcal, 10 g protein,
// 8 g fat and 22 g carbs per 100 g: 500 kcal, 25 g protein, 20 g fat, 55 g carbs.

const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, hour).getTime();
};

async function mealOn(request: APIRequestContext, eatenAt: number, text: string, analyse: boolean) {
  const { meal } = (await (
    await request.post(mealPaths.meals, { data: { eatenAt } })
  ).json()) as MealResponse;
  expect((await request.post(mealPaths.captures(meal.id), { data: { kind: "text", text } })).ok()).toBe(true);
  if (!analyse) return meal.id;
  expect((await request.post(mealPaths.analyse(meal.id), { data: {} })).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        ((await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse).meal.status,
      { timeout: 20_000 },
    )
    .toBe("analysed");
  return meal.id;
}

test("set daily targets from the overview, fix a typo in place; the history keeps every goal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Goals and weight" }).click();
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();

  // nothing set yet: no slab until something changes
  await expect(page.getByText("not set")).toBeVisible();
  await expect(page.getByTestId("save-goal")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Energy target in kcal" }).fill("2100");
  await page.getByRole("textbox", { name: "Protein target in g" }).fill("abc");
  await expect(page.getByTestId("save-goal")).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Check Protein");
  await page.getByRole("textbox", { name: "Protein target in g" }).fill("150");
  await page.getByRole("textbox", { name: "Fibre target in g" }).fill("30");
  await expect(page.getByTestId("fix-toggle")).toHaveCount(0); // nothing to fix yet
  await page.getByTestId("save-goal").click();
  await expect(page.getByText("since today")).toBeVisible();
  await expect(page.getByTestId("save-goal")).toHaveCount(0);

  // a typo: fixed in place, no second goal
  await page.getByRole("textbox", { name: "Energy target in kcal" }).fill("2000");
  await expect(page.getByTestId("save-goal")).toHaveText(/Save · from today/);
  await page.getByTestId("fix-toggle").click();
  await expect(page.getByTestId("save-goal")).toHaveText(/Fix current goal/);
  await page.getByTestId("save-goal").click();
  await expect(page.getByTestId("save-goal")).toHaveCount(0);
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.getByTestId("goal-row")).toHaveCount(1);
  await expect(page.getByTestId("goal-row").first()).toContainText("2,000");

  // new targets: a second goal from today replaces the first for today, both stay listed
  await page.getByRole("textbox", { name: "Protein target in g" }).fill("160");
  await page.getByTestId("save-goal").click();
  await expect(page.getByTestId("goal-row")).toHaveCount(2);
  await expect(page.locator('[data-testid="goal-row"][data-in-force="true"]')).toContainText("160");
  await expect(page.getByTestId("goal-row").nth(1)).toContainText("replaced the same day");

  // the overview's ink slab now counts down from today's target
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("today-totals").getByTestId("kcal-left")).toContainText("left of 2,000");
  await expect(page.getByTestId("today-totals")).toContainText("/160");
});

test("log weight in seconds from the overview: one field, one tap; undo and delete", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Goals and weight" }).click();
  const entry = page.getByTestId("weight-entry");
  const field = entry.getByRole("textbox", { name: "Weight in kg" });
  await field.fill("81,4"); // a German keypad's decimal comma
  await entry.getByRole("button", { name: "Log" }).click();
  await expect(page.getByTestId("logged")).toContainText("Logged 81.4 kg");
  await expect(page.getByTestId("weight-avg")).toHaveText("81.4");

  // a typo, undone at once
  await field.fill("84.1");
  await entry.getByRole("button", { name: "Log" }).click();
  await expect(page.getByTestId("logged")).toContainText("84.1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("logged")).toHaveCount(0);
  await expect(page.getByTestId("weight-avg")).toHaveText("81.4");

  // an earlier time, and deleting from the list
  await page.getByRole("button", { name: /change time/ }).click();
  const yesterday = new Date(Date.now() - 86_400_000);
  yesterday.setHours(7, 0, 0, 0);
  const local = `${ymd(yesterday.getTime())}T07:00`;
  await page.getByLabel("Measured at").fill(local);
  await field.fill("82");
  await entry.getByRole("button", { name: "Log" }).click();
  await expect(page.getByTestId("logged")).toContainText("82.0 kg · 07:00");
  await page.getByRole("button", { name: /^Weight entries/ }).click();
  const rows = page.getByTestId("weight-row");
  await expect(rows).toHaveCount(2);
  await rows
    .filter({ hasText: "82.0" })
    .getByRole("button", { name: /^Delete/ })
    .click();
  await rows.filter({ hasText: "82.0" }).getByRole("button", { name: "Delete?" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("81.4");
});

test("the day view: progress against the goal in force that day, a meal not counted yet, stepping days", async ({
  page,
  request,
}) => {
  // a day long ago with its own goal, so other specs' meals and today's goal don't touch it
  const day = ymd(Date.now() - 40 * 86_400_000);
  const goal = { energyKcal: 800, protein: 20, fat: 30, carbohydrate: null, fiber: null, note: "Test" };
  expect(
    (await request.post(goalPaths.goals, { data: { ...goal, effectiveFrom: addDays(day, -1) } })).ok(),
  ).toBe(true);
  await mealOn(request, at(day, 12), "Mittagessen", true);
  await mealOn(request, at(day, 18), "Abendessen, noch nicht analysiert", false);
  expect((await request.post(weightPaths.weight, { data: { kg: 80.2, measuredAt: at(day, 7) } })).ok()).toBe(
    true,
  );

  await page.goto(`/days/${day}`);
  const totals = page.getByTestId("day-totals");
  await expect(totals.getByTestId("kcal")).toHaveText("500");
  // under on kcal: what's left, in lime
  await expect(totals.getByTestId("kcal-left")).toHaveText(/300\s*left of 800/);
  await expect(totals.getByTestId("kcal-left")).toHaveAttribute("data-over", "false");
  // over on protein: the bar runs past the target, the cell says by how much
  await expect(totals.getByTestId("macro-protein")).toHaveAttribute("data-over", "true");
  await expect(totals.getByTestId("macro-protein")).toContainText("5 over");
  await expect(totals.getByTestId("macro-protein").getByTestId("over")).toBeVisible();
  await expect(totals.getByTestId("macro-fat")).toContainText("10 left");
  // no target for carbs: plain grams, no bar
  await expect(totals.getByTestId("macro-carbohydrate")).toContainText("55g");
  await expect(totals.getByTestId("macro-carbohydrate").getByRole("img")).toHaveCount(0);
  // the unanalysed meal is listed, marked, and said not to be counted
  await expect(totals).toContainText("1 meal not counted yet");
  await expect(page.getByTestId("meal-row")).toHaveCount(2);
  await expect(page.getByTestId("not-counted")).toHaveCount(1);
  await expect(page.getByTestId("day-goal")).toContainText("Goal since");
  await expect(page.getByTestId("day-weight")).toContainText("80.2");

  // over on kcal: the day the goal started had nothing, the day after it is a fresh day
  await page.getByTestId("day-prev").click();
  await expect(page).toHaveURL(new RegExp(`/days/${addDays(day, -1)}$`));
  await expect(totals.getByTestId("kcal")).toHaveText("0");
  await expect(page.getByTestId("day-goal")).toContainText("Goal since");
  await page.getByTestId("day-prev").click();
  await expect(page.getByTestId("day-goal")).toContainText("No targets for this day");
  await expect(totals.getByTestId("kcal-left")).toHaveCount(0);

  // two days on: back where we were; a second meal pushes it over
  await page.getByTestId("day-next").click();
  await page.getByTestId("day-next").click();
  await expect(page).toHaveURL(new RegExp(`/days/${day}$`));
  await mealOn(request, at(day, 15), "Kuchen", true);
  await page.reload();
  await expect(totals.getByTestId("kcal")).toHaveText("1,000");
  await expect(totals.getByTestId("kcal-left")).toHaveAttribute("data-over", "true");
  await expect(totals.getByTestId("kcal-left")).toHaveText(/\+200\s*over 800/);

  // today can't step into the future; the overview's day header opens a day
  await page.goto(`/days/${ymd(Date.now())}`);
  await expect(page.getByTestId("day-title")).toHaveText("Today");
  await expect(page.getByTestId("day-next")).toBeDisabled();
  await page.goto("/");
  await page.getByTestId("older-days").click();
  await expect(page).toHaveURL(/\/days\/\d{4}-\d{2}-\d{2}$/);
});
