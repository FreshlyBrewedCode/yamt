import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import type { MealDetailResponse, MealResponse, MealStatus } from "../packages/shared/src/api-meals.ts";
import { mealPaths } from "../packages/shared/src/api-meals.ts";
import { OWN_ORIGIN } from "./api.ts";

// The meal detail (#11) on the phone, against meals the fake agent analyses (see the header of
// packages/server/test/fake-agent.ts): `fake:meal` is a made-up curry with five items, every
// provenance and a low-confidence rice portion (838 kcal); `:question` adds a question until the
// meal has an answer. Each answer or correction since makes the rice 30 g smaller (−39 kcal).

/** A meal with these text captures, analysed by the fake agent until it reaches `status`. */
async function seedMeal(request: APIRequestContext, texts: string[], status: MealStatus): Promise<string> {
  const { meal } = (await (
    await request.post(mealPaths.meals, { headers: OWN_ORIGIN, data: {} })
  ).json()) as MealResponse;
  for (const text of texts) {
    expect(
      (
        await request.post(mealPaths.captures(meal.id), { headers: OWN_ORIGIN, data: { kind: "text", text } })
      ).ok(),
    ).toBe(true);
  }
  expect((await request.post(mealPaths.analyse(meal.id), { headers: OWN_ORIGIN, data: {} })).ok()).toBe(true);
  await expect
    .poll(
      async () =>
        ((await (await request.get(mealPaths.meal(meal.id))).json()) as MealDetailResponse).meal.status,
      {
        timeout: 20_000,
      },
    )
    .toBe(status);
  return meal.id;
}

const slab = (page: Page) => page.getByTestId("detail-slab");
const kcal = (page: Page) => page.getByTestId("meal-totals").getByTestId("kcal");

test("answer the agent's question: re-analysed into a new revision; history and trace show why", async ({
  page,
  request,
}) => {
  const mealId = await seedMeal(
    request,
    ["Kürbis-Linsen-Curry mit Reis", "fake:meal:question"],
    "needs_input",
  );
  await page.goto(`/meals/${mealId}`);

  // the detail: numbers (preliminary), the question in lime, items with provenance
  await expect(page.getByTestId("meal-title")).toHaveText("Kürbis-Linsen-Curry mit Reis");
  await expect(kcal(page)).toHaveText("838");
  await expect(page.getByTestId("meal-totals")).toContainText("preliminary");
  await expect(page.getByTestId("questions")).toContainText("Wie viel Reis war auf dem Teller?");
  const items = page.getByTestId("item");
  await expect(items).toHaveCount(5);
  await expect(page.locator('[data-testid="item"][data-confidence="low"]')).toContainText("Basmatireis");
  for (const p of ["weighed", "label", "database", "estimate"]) {
    await expect(page.locator(`[data-provenance="${p}"]`).first()).toBeVisible();
  }
  // an item's source: the label food the agent created
  await items.filter({ hasText: "Kokosmilch" }).getByRole("button").click();
  await expect(page.getByTestId("item-source")).toContainText("Package label");
  await expect(page.getByTestId("item-source")).toContainText("Testmarke");

  // nothing to send until the question is answered
  await expect(slab(page)).toBeDisabled();
  await page.getByRole("textbox", { name: /^Answer:/ }).fill("Eher 150 g gekocht");
  await expect(slab(page)).toHaveText(/Answer & re-analyse/);
  await slab(page).click();

  // queued, analysed again, a new revision without the question
  await expect(slab(page)).toHaveText(/Add more/, { timeout: 20_000 });
  await expect(kcal(page)).toHaveText("799");
  await expect(page.getByTestId("questions")).toHaveCount(0);
  const detail = (await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.captures.find((c) => c.kind === "answer")).toMatchObject({ text: "Eher 150 g gekocht" });
  expect(detail.revision?.revision.number).toBe(2);

  // revision history: both, with the change and what caused it
  await page.getByRole("button", { name: /^Revisions/ }).click();
  const revisions = page.getByTestId("revision");
  await expect(revisions).toHaveCount(2);
  await expect(revisions.first()).toContainText("799");
  await expect(revisions.first()).toContainText("−39");
  await expect(revisions.first()).toContainText(/after 1 answer/i);
  await revisions.nth(1).getByRole("button").first().click();
  await expect(page.getByTestId("revision-body")).toContainText("Eher 150 g gekocht");

  // the trace of the current revision's run, fetched when opened
  const traceLoaded = page.waitForResponse((r) => /\/api\/runs\/[^/]+\/trace$/.test(r.url()));
  await page
    .getByRole("button", { name: /^Trace/ })
    .last()
    .click();
  await traceLoaded;
  const trace = page.getByTestId("trace-section").getByTestId("trace");
  await expect(trace).toContainText("Custom agent");
  await expect(trace.locator('[data-tool="get_meal"]')).toBeVisible();
  await expect(trace.locator('[data-tool="create_food"]')).toHaveCount(2);
  const save = trace.locator('[data-tool="save_meal_revision"]');
  await expect(save).toContainText("saved revision 2 · 799 kcal");
  await save.getByRole("button").click();
  await expect(save.getByTestId("trace-tool-detail")).toContainText(
    '"title": "Kürbis-Linsen-Curry mit Reis"',
  );
  await expect(trace.getByTestId("trace-message").last()).toContainText("Gespeichert.");
});

test("a correction and the time it was eaten", async ({ page, request }) => {
  const mealId = await seedMeal(request, ["Kürbis-Linsen-Curry", "fake:meal"], "analysed");
  await page.goto(`/meals/${mealId}`);
  await expect(kcal(page)).toHaveText("838");
  await expect(slab(page)).toHaveText(/Add more/);

  // when: yesterday 12:30 pins it
  await page.getByTestId("eaten-at").click();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  await page
    .getByLabel("Eaten at", { exact: true })
    .fill(`${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}T12:30`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("eaten-at")).toHaveText(/Yesterday, 12:30/);
  const meal = ((await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse).meal;
  expect(meal.eatenAtSource).toBe("user");

  // a correction goes up through the queue and re-analyses
  await page.getByRole("textbox", { name: "Correction" }).fill("Nur die halbe Portion Reis");
  await expect(slab(page)).toHaveText(/Correct & re-analyse/);
  await slab(page).click();
  await expect(slab(page)).toHaveText(/Add more/, { timeout: 20_000 });
  await expect(kcal(page)).toHaveText("799");
  const detail = (await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  expect(detail.captures.filter((c) => c.kind === "correction").map((c) => c.text)).toEqual([
    "Nur die halbe Portion Reis",
  ]);
  // the analysis didn't move the time the user set
  expect(detail.meal.eatenAt).toBe(meal.eatenAt);
});

test("a spoken answer, recorded in place, is transcribed and answers the question", async ({
  page,
  request,
}) => {
  const mealId = await seedMeal(request, ["Curry", "fake:meal:question"], "needs_input");
  await page.goto(`/meals/${mealId}`);
  await page.getByRole("button", { name: "Speak answer" }).click();
  await expect(page.getByTestId("recording")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop the spoken answer" }).click();

  const reply = page.getByTestId("questions").getByTestId("reply");
  await expect(reply).toHaveCount(1);
  // the fake STT's transcript arrives (the meal polls while a transcript is pending)
  await expect(reply).toContainText("“", { timeout: 20_000 });
  const detail = (await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse;
  const answer = detail.captures.find((c) => c.kind === "answer");
  expect(answer?.mimeType).toMatch(/^audio\//);
  expect(answer?.questionId).toBe(detail.revision?.questions[0]?.id);

  await expect(slab(page)).toHaveText(/Answer & re-analyse/);
  await slab(page).click();
  await expect(slab(page)).toHaveText(/Add more/, { timeout: 20_000 });
  await expect(kcal(page)).toHaveText("799");
});

test("a failed analysis shows why and can be retried", async ({ page, request }) => {
  const mealId = await seedMeal(request, ["Müsli", "fake:auth"], "failed");
  await page.goto(`/meals/${mealId}`);
  await expect(page.getByTestId("failed")).toContainText("Not logged in");
  await expect(page.getByTestId("meal-totals")).toHaveCount(0);
  await expect(slab(page)).toHaveText(/Retry analysis/);
  // its trace shows the failure
  await page.getByRole("button", { name: /^Trace/ }).click();
  await expect(page.getByTestId("trace").getByTestId("trace-error").first()).toContainText("authentication");

  await slab(page).click();
  // the fake agent fails the same way again: a second run, failed once more
  await expect
    .poll(
      async () => ((await (await request.get(mealPaths.meal(mealId))).json()) as MealDetailResponse).runs,
      {
        timeout: 20_000,
      },
    )
    .toMatchObject([{ status: "failed" }, { status: "failed" }]);
  await expect(page.getByTestId("failed")).toContainText("Not logged in");
  await expect(slab(page)).toHaveText(/Retry analysis/);
});
