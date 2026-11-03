import { expect, type Page, test } from "@playwright/test";

// Guided goal setup (#24) on the phone: the research report's fixture (man, 30 y, 180 cm, 80 kg,
// 15 % body fat, sitting with some walking, 3 strength sessions of 60 min), cut at the standard
// pace → 2,660 kcal, 160 g protein, 90 g fat, 285 g carbs, 35 g fibre; then nudged through the
// presets and saved. Made-up numbers throughout. The weight is typed (and so logged), and with
// fewer than four entries in the last week the newest entry is the one used.

test("guided setup: refusals, five steps, live presets, saved from today with its explanation", async ({
  page,
}) => {
  const year = new Date().getFullYear();
  const next = page.getByTestId("guided-next");

  await page.goto("/goals");
  await page.getByTestId("guided-entry").click();
  await expect(page.getByTestId("guided-step")).toHaveText(/1 \/ 5/);
  await expect(next).toBeDisabled();

  // refusals say why, neutrally, and offer no way on
  await page.getByRole("textbox", { name: "Born in year" }).fill(String(year - 16));
  await expect(page.getByTestId("refusal")).toContainText("under 18");
  await expect(next).toHaveCount(0);
  await page.getByRole("textbox", { name: "Born in year" }).fill(String(year - 30));
  await page.getByRole("button", { name: "Female", exact: true }).click();
  await page.getByTestId("pregnant-toggle").click();
  await expect(page.getByTestId("refusal")).toContainText("pregnancy and breastfeeding");
  await page.getByTestId("pregnant-toggle").click();
  await expect(page.getByTestId("refusal")).toHaveCount(0);

  // 1: you
  await page.getByRole("button", { name: "Male", exact: true }).click();
  await expect(page.getByTestId("pregnant-toggle")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Height in cm" }).fill("180");
  await page.getByRole("textbox", { name: "Body fat in %" }).fill("15");
  await page.getByRole("textbox", { name: "Weight in kg" }).fill("80");
  await expect(page.getByTestId("weight-source")).toContainText("Using 80.0 kg");
  await next.click();

  // 2: daily life
  await expect(page.getByTestId("guided-step")).toHaveText(/2 \/ 5/);
  await expect(next).toBeDisabled();
  await page.getByTestId("daily-some_walking").click();
  await next.click();

  // 3: training; 0 sessions skips the rest
  await expect(page.getByTestId("type-strength")).toHaveCount(0);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "More: Sessions per week" }).click();
  await expect(page.getByTestId("stepper-value")).toContainText("3");
  await expect(page.getByTestId("type-strength")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Typical duration" }).getByRole("button", { name: /60/, pressed: true }),
  ).toBeVisible();
  await next.click();

  // 4: goal, with what each pace means
  await expect(next).toBeDisabled();
  await page.getByTestId("goal-cut").click();
  await expect(page.getByTestId("pace-standard")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pace-standard")).toContainText("≈ 0.4 kg a week, −440 kcal a day");
  await next.click();

  // 5: the review
  const slab = page.getByTestId("review-slab");
  await expect(slab.getByTestId("review-kcal")).toHaveText("2,660");
  await expect(slab.getByTestId("review-maintenance")).toHaveText("3,100");
  await expect(slab.getByTestId("review-delta")).toContainText("−440 kcal a day");
  await expect(slab.getByTestId("review-protein")).toContainText("160g");
  await expect(slab.getByTestId("review-fat")).toContainText("90g");
  await expect(slab.getByTestId("review-carbs")).toContainText("285g");
  await expect(slab.getByTestId("review-fiber")).toContainText("35g");
  // every number names its formula or source
  await expect(
    page.getByText("160 g ≈ 2.0 g/kg, protects muscle while cutting (Helms 2014, ISSN)"),
  ).toBeVisible();
  await expect(
    page.getByText(/Cunningham \(1980\) from your lean mass .* Mifflin-St Jeor would give ≈1,780$/),
  ).toBeVisible();
  await expect(page.getByText(/at 5 MET \(2024 Compendium\), counted at 75 %/)).toBeVisible();
  // and how it's calculated, closed until asked
  const method = page.getByTestId("goal-method");
  await expect(method).not.toContainText("ten Haaf");
  await method.getByRole("button", { name: "How this is calculated" }).click();
  await expect(method).toContainText("ten Haaf 2014");
  await expect(method).toContainText("A starting estimate");
  await expect(method.getByTestId("goal-research")).toHaveAttribute(
    "href",
    /reports\/Goal%20setting%20research\.md$/,
  );
  await expect(page.getByTestId("split-bar")).toHaveAttribute("aria-label", /Prot 24 %, Fat 30 %, Carb 43 %/);

  // back keeps the answers
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.getByTestId("goal-cut")).toHaveAttribute("aria-pressed", "true");
  await next.click();

  // nudged through presets and the slider, live
  await page
    .getByTestId("protein-chips")
    .getByRole("button", { name: /Very high/ })
    .click();
  await expect(slab.getByTestId("review-protein")).toContainText("190g");
  await page.getByRole("slider", { name: "Fat, % of energy" }).fill("25");
  await expect(page.getByTestId("fat-chips").getByRole("button", { name: /Lower/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByTestId("pace-chips")
    .getByRole("button", { name: /Gentle/ })
    .click();
  await expect(slab.getByTestId("review-kcal")).toHaveText("2,880");
  await expect(slab.getByTestId("review-fat")).toContainText("80g");
  await expect(slab.getByTestId("review-carbs")).toContainText("330g");
  await expect(slab.getByTestId("review-fiber")).toContainText("40g");

  await expect(next).toHaveText(/Save · from today/);
  await next.click();

  // back on the goals screen: the new goal in force, explained, and in the history
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
  await expect(page.getByText("since today")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Energy target in kcal" })).toHaveValue("2880");
  await expect(page.getByRole("textbox", { name: "Protein target in g" })).toHaveValue("190");
  await expect(page.getByRole("textbox", { name: "Carbs target in g" })).toHaveValue("330");
  await page.getByRole("button", { name: /^Why these targets/ }).click();
  await expect(page.getByTestId("goal-explanation")).toContainText("Guided · cut, gentle pace");
  await expect(page.getByTestId("goal-explanation")).toContainText("190 g ≈ 2.4 g/kg");
  await expect(page.getByTestId("goal-explanation")).toContainText("Algorithm v2");
  await page.getByTestId("goal-why").getByRole("button", { name: "How this is calculated" }).click();
  await expect(page.getByTestId("goal-why").getByTestId("goal-method")).toContainText("Cunningham (1980)");
  await page.getByRole("button", { name: /^History/ }).click();
  await expect(page.locator('[data-testid="goal-row"][data-in-force="true"]')).toContainText(
    "Guided · cut, gentle pace",
  );
  // the typed weight was logged
  await expect(page.getByTestId("weight-entry")).toContainText("last 80.0 kg");

  // the overview counts down from it
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("today-totals").getByTestId("kcal-left")).toContainText("2,880");

  // next time: Recalculate, pre-filled from the profile and the guided goal's choices
  await page.getByRole("link", { name: "Goals and weight" }).click();
  await expect(page.getByTestId("guided-entry")).toContainText("Recalculate");
  await page.getByTestId("guided-entry").click();
  await expect(page.getByRole("textbox", { name: "Height in cm" })).toHaveValue("180");
  await expect(page.getByRole("textbox", { name: "Weight in kg" })).toHaveValue("");
  await next.click();
  await expect(page.getByTestId("daily-some_walking")).toHaveAttribute("aria-pressed", "true");
  await next.click();
  await expect(page.getByTestId("stepper-value")).toContainText("3");
  await next.click();
  await expect(page.getByTestId("pace-gentle")).toHaveAttribute("aria-pressed", "true");
});

// A goal saved by algorithm v1 keeps its stored explanation, and "How this is calculated" shows
// v1's rule (Cunningham whenever lean), not today's.
test("a v1 guided goal explains itself as v1 did", async ({ page }) => {
  await page.goto("/goals");
  await saveFixtureGoal(page);
  await page.route("**/api/goals", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const goal of body.goals) {
      const d = goal.derivation;
      if (!d) continue;
      d.version = 1;
      d.result.version = 1;
      d.result.rmr = { kcal: 1996, equation: "cunningham", ffmKg: 68 };
      d.result.lines.rmr =
        "≈2,000 kcal at rest from your lean mass (68.0 kg at 15 % body fat; Cunningham, suits lean, active people)";
      d.result.lines.protein = "160 g ≈ 2.0 g/kg, protects muscle while cutting";
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  const why = page.getByTestId("goal-why");
  await why.getByRole("button", { name: /^Why these targets/ }).click();
  await expect(why.getByTestId("goal-explanation")).toContainText("Cunningham, suits lean, active people");
  await expect(why.getByTestId("goal-explanation")).toContainText(
    "160 g ≈ 2.0 g/kg, protects muscle while cutting",
  );
  await expect(why.getByTestId("goal-explanation")).toContainText("Algorithm v1");
  await why.getByRole("button", { name: "How this is calculated" }).click();
  await expect(why.getByTestId("goal-method")).toContainText("Version 1 used Cunningham");
  await expect(why.getByTestId("goal-method")).not.toContainText("ten Haaf");
});

/** The fixture as a guided goal from today, through the API (what the flow posts). */
async function saveFixtureGoal(page: Page) {
  const origin = new URL(page.url()).origin;
  const res = await page.request.post("/api/goals/guided", {
    headers: { origin },
    data: {
      profile: {
        sex: "male",
        birthYear: new Date().getFullYear() - 30,
        heightCm: 180,
        bodyFatPct: 15,
        dailyLife: "some_walking",
        training: { sessionsPerWeek: 3, minutes: 60, type: "strength", intensity: "moderate" },
      },
      choices: { goal: "cut", pace: "standard", protein: "high", fatPercent: 30 },
      pregnantOrBreastfeeding: false,
      weightKg: 80,
    },
  });
  expect(res.status()).toBe(201);
}
