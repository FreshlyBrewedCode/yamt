import { expect, test } from "@playwright/test";
import { leftoverPaths } from "../packages/shared/src/api-leftovers.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { planningPaths } from "../packages/shared/src/api-planning.ts";
import { OWN_ORIGIN } from "./api.ts";
import { callTool } from "./mcp.ts";

// Leftovers and the shopping list (#49): "Ate it" with cook 2, eat 1 keeps a portion; the plan
// offers it and Plan it puts it on the plan; a leftover added by hand comes off the shopping list
// of a range of days, where a line goes into the basket (and stays there) and a line of one's own
// is added. Made-up recipe for 2: 400 g Testkürbis, 200 g Testlinsen, 1 Testzwiebel (100 g). The
// spec leaves the shared server's plan as it found it.

const BASE = `http://localhost:${process.env.YAMT_E2E_PORT ?? 7898}`;
const DATA = process.env.YAMT_E2E_DATA_DIR!;

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const estimate = (energyKcal: number) => ({ energyKcal, protein: 10, fat: 5, carbohydrate: 10, fiber: 2 });
const item = (description: string, grams: number, kcal: number) => ({
  description,
  grams,
  provenance: "estimate",
  confidence: "medium",
  estimatePer100g: estimate(kcal),
});

test("cook 2 → a leftover the plan offers → plan it; the shopping list for a range → check off", async ({
  page,
  request,
}) => {
  const { recipeId } = await callTool<{ recipeId: string }>(BASE, DATA, "save_recipe", {
    title: "Testeintopf mit Rest",
    summary: "Ein erfundenes Rezept",
    sourceMode: "composed",
    servings: 2,
    timeTotalMin: 30,
    steps: ["Kochen."],
    items: [
      item("Testkürbis", 400, 40),
      item("Testlinsen (trocken)", 200, 340),
      item("1 Testzwiebel", 100, 40),
    ],
  });
  const { plannedMealId } = await callTool<{ plannedMealId: string }>(BASE, DATA, "plan_meal", {
    recipeId,
    date: localDate(),
    slot: "lunch",
    portionsCooked: 2,
  });

  // Ate it from the recipe: the sheet says one portion stays a leftover
  await page.goto(`/planned/${plannedMealId}`);
  await page.getByTestId("recipe-ate-it").click();
  const sheet = page.getByTestId("ate-it");
  await expect(sheet.getByTestId("ate-it-leftover")).toContainText("1 portion");
  await expect(sheet.getByTestId("ate-it-leftover")).toContainText(
    "kept as a leftover: the plan offers it from tomorrow",
  );
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(page).toHaveURL(/\/meals\//);
  const mealId = new URL(page.url()).pathname.split("/").pop()!;

  // the plan offers it on a next day, and lists it under Leftovers; Plan it puts it on that slot
  await page.goto("/plan/days");
  const offer = page.getByTestId("leftover-offer").filter({ hasText: "Testeintopf mit Rest" });
  await expect(offer).toContainText("Leftover · 1 portion");
  const row = page.getByTestId("leftover-row").filter({ hasText: "Testeintopf mit Rest" });
  await expect(row).toContainText("1 portion");
  await expect(row).toContainText("offered for");
  await offer.getByTestId("plan-it").click();
  await expect(offer).toHaveCount(0);
  const planned = page.locator('[data-testid="planned-row"][data-status="planned"]').filter({
    hasText: "Testeintopf mit Rest",
  });
  await expect(planned).toContainText("Leftover ·");
  await expect(planned).toContainText("From the leftovers · eat 1");
  await expect(row).toContainText("planned for");

  // a leftover by hand: half the lentils are at home
  await page.getByTestId("add-leftover").click();
  const add = page.getByTestId("add-leftover-sheet");
  await add.getByLabel("What").fill("Testlinsen");
  await add.getByLabel("Grams").fill("150");
  await add.getByRole("button", { name: "Add leftover" }).click();
  await expect(page.getByTestId("leftover-row").filter({ hasText: "Testlinsen" })).toContainText("150 g");

  // the shopping list for a day far ahead, cooking 4 portions there (double the recipe)
  const day = plus(20);
  const { plannedMealId: ahead } = await callTool<{ plannedMealId: string }>(BASE, DATA, "plan_meal", {
    recipeId,
    date: day,
    slot: "dinner",
    portionsCooked: 4,
  });
  await page.goto(`/plan/shopping?from=${day}&to=${day}`);
  await expect(page.getByTestId("in-basket")).toHaveText("0");
  await expect(page.getByTestId("to-buy")).toHaveText("/3");
  const pumpkin = page.getByTestId("shopping-line").filter({ hasText: "Testkürbis" });
  await expect(pumpkin).toContainText("800");
  const lentils = page.getByTestId("shopping-line").filter({ hasText: "Testlinsen" });
  await expect(lentils).toContainText("250");
  await expect(lentils).toContainText("150 g Testlinsen at home");
  await expect(page.getByTestId("shopping-line").filter({ hasText: "Testzwiebel" })).toHaveAttribute(
    "data-key",
    "name:testzwiebel",
  );
  // a tap shows which recipes need it
  await pumpkin.getByTestId("line-name").click();
  await expect(pumpkin.getByTestId("line-needs")).toContainText("Testeintopf mit Rest");
  // into the basket; still there after a reload
  await pumpkin.getByTestId("check").click();
  await expect(pumpkin).toHaveAttribute("data-checked", "true");
  await expect(page.getByTestId("in-basket")).toHaveText("1");
  await page.reload();
  await expect(page.getByTestId("shopping-line").filter({ hasText: "Testkürbis" })).toHaveAttribute(
    "data-checked",
    "true",
  );
  // the range sheet shows the days; a line of one's own
  await page.getByTestId("change-range").click();
  await expect(page.getByTestId("range-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("add-line").click();
  await page.getByTestId("line-text").fill("Testlimetten (2)");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByTestId("shopping-line").filter({ hasText: "Testlimetten (2)" })).toContainText(
    "Added by you",
  );
  await expect(page.getByTestId("to-buy")).toHaveText("/4");

  // leave the plan as it was: the leftover's planned meal, the far one, the logged meal and its
  // planned meal, the lentils
  const leftovers = (await (await request.get(leftoverPaths.leftovers)).json()) as {
    leftovers: { id: string; description: string; plannedFor: { plannedMealId: string }[] }[];
  };
  const own = leftovers.leftovers.find((l) => l.description === "Testeintopf mit Rest")!;
  for (const p of own.plannedFor) {
    expect(
      (await request.delete(planningPaths.plannedMeal(p.plannedMealId), { headers: OWN_ORIGIN })).ok(),
    ).toBe(true);
  }
  expect((await request.delete(planningPaths.plannedMeal(ahead), { headers: OWN_ORIGIN })).ok()).toBe(true);
  expect((await request.post(mealPaths.remove(mealId), { headers: OWN_ORIGIN })).ok()).toBe(true);
  expect((await request.delete(planningPaths.plannedMeal(plannedMealId), { headers: OWN_ORIGIN })).ok()).toBe(
    true,
  );
  const lentilsLeftover = leftovers.leftovers.find((l) => l.description === "Testlinsen")!;
  await request.patch(leftoverPaths.leftover(lentilsLeftover.id), {
    headers: OWN_ORIGIN,
    data: { status: "gone" },
  });
  const after = (await (await request.get(leftoverPaths.leftovers)).json()) as {
    leftovers: { description: string }[];
  };
  expect(after.leftovers.filter((l) => l.description.startsWith("Test"))).toEqual([]);
});
