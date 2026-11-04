import { expect, test } from "@playwright/test";
import { CALENDAR_URL } from "./api.ts";
import { type CalendarSeed, seedCalendar } from "./calendar-seed.ts";

// The calendar (#33) on the phone, against a server of its own (playwright.config.ts) seeded with
// four made-up months: none with a goal, a maintain goal from the 7th, a cut from the 14th, and
// this month so far (see calendar-seed.ts).

const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(`${month}-15T12:00:00`));

test("the calendar: this month, stepping back through the goals, picking a day, opening it", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const ctx = await playwright.request.newContext({
    baseURL: CALENDAR_URL,
    extraHTTPHeaders: { origin: CALENDAR_URL },
  });
  const ok = async <T>(res: Awaited<ReturnType<typeof ctx.get>>) => {
    expect(res.ok(), `${res.url()}: ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  };
  const seed: CalendarSeed = await seedCalendar({
    post: async (path, body) => ok(await ctx.post(path, { data: body })),
    get: async (path) => ok(await ctx.get(path)),
  });
  await ctx.dispose();
  const [noGoal, maintain, cut, now] = seed.months;
  const grid = page.getByTestId("month-grid");
  const square = (date: string) => page.locator(`[data-testid="day-square"][data-date="${date}"]`);
  const legend = page.getByTestId("legend-range");

  // from the overview's header: this month, today selected, no stepping into the future
  await page.goto(`${CALENDAR_URL}/`);
  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(now));
  await expect(grid).toHaveAttribute("data-loaded", "true");
  await expect(square(seed.today)).toHaveAttribute("aria-pressed", "true");
  await expect(square(seed.today).getByTestId("not-analysed")).toBeVisible(); // lunch isn't analysed yet
  await expect(page.getByTestId("selected-totals")).toContainText("1 meal not counted yet");
  await expect(page.getByTestId("month-next")).toBeDisabled();
  await expect(page.getByTestId("open-day")).toHaveText(/Open Today/);
  await expect(legend).toHaveText([
    "Cut, standard pace, on plan from 15 % under to 5 % over the kcal target.",
  ]);

  // a month back: the cut from mid-month, after the maintain goal; the last day selected
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(cut));
  await expect(page).toHaveURL(new RegExp(`month=${cut}`));
  await expect(grid).toHaveAttribute("data-month", cut);
  await expect(grid).toHaveAttribute("data-loaded", "true");
  const last = await page
    .locator('[data-testid="day-square"][aria-pressed="true"]')
    .getAttribute("data-date");
  expect(last?.startsWith(cut) && Number(last.slice(8)) >= 28).toBe(true);
  await expect(legend).toHaveText([
    /^From 1 \w+: Maintain, on plan within 10 % of the kcal target\.$/,
    /^From 14 \w+: Cut, standard pace, on plan from 15 % under to 5 % over the kcal target\.$/,
  ]);
  // each day against its own goal: on plan under, just off over, far off and too low, far off over
  await expect(square(`${cut}-14`)).toHaveAttribute("data-band", "on");
  await expect(square(`${cut}-14`)).toHaveAttribute("data-direction", "under");
  await expect(square(`${cut}-17`)).toHaveAttribute("data-band", "just");
  await expect(square(`${cut}-17`)).toHaveAttribute("data-direction", "over");
  await expect(square(`${cut}-21`)).toHaveAttribute("data-band", "far");
  await expect(square(`${cut}-21`)).toHaveAttribute("data-too-low", "true");
  await expect(square(`${cut}-31`)).toHaveAttribute("data-direction", "over");
  await expect(square(`${cut}-10`)).toHaveAttribute("data-band", "far"); // maintain, +38 %
  await expect(square(`${cut}-04`)).toHaveAttribute("data-band", "none"); // nothing logged
  await expect(square(`${cut}-29`).getByTestId("not-analysed")).toBeVisible();
  await expect(page.getByTestId("week-square").first()).toBeVisible();
  await expect(page.getByTestId("month-weight")).toBeVisible();

  // picking a day: its row and totals on the same ink, its URL; Open goes to the day view
  await square(`${cut}-17`).click();
  await expect(page).toHaveURL(new RegExp(`day=${cut}-17`));
  await expect(square(`${cut}-17`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("selected-day-row")).toContainText("Cut, standard pace");
  await expect(page.getByTestId("plan-words")).toHaveText("Just off, over");
  await expect(page.getByTestId("selected-totals").getByTestId("kcal-left")).toHaveAttribute(
    "data-over",
    "true",
  );
  await page.getByTestId("open-day").click();
  await expect(page).toHaveURL(new RegExp(`/days/${cut}-17$`));
  await expect(page.getByTestId("day-goal")).toContainText("Cut, standard pace");

  // the day view links back to its month, with the day selected
  await page.getByTestId("day-calendar").click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(cut));
  await expect(square(`${cut}-17`)).toHaveAttribute("aria-pressed", "true");

  // two months back: no goal until the 7th, then maintain; three: no goal at all, kcal only
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(maintain));
  await expect(legend).toHaveText([
    /^Until 6 \w+: no goal, kcal only\.$/,
    /^From 7 \w+: Maintain, on plan within 10 % of the kcal target\.$/,
  ]);
  await expect(square(`${maintain}-14`)).toHaveAttribute("data-too-low", "true"); // 42 %: under the floor
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(noGoal));
  await expect(legend).toHaveText(["No goal this month: the squares show kcal only."]);
  await expect(square(`${noGoal}-10`)).toHaveAttribute("data-band", "none");
  await expect(square(`${noGoal}-10`)).toHaveText(/\d+\s*\d\.\dk/);
  await expect(page.getByTestId("kcal-share")).toContainText("—");

  // back to now
  for (let i = 0; i < 3; i++) await page.getByTestId("month-next").click();
  await expect(page.getByTestId("calendar-title")).toHaveText(monthName(now));
  await expect(page.getByTestId("month-next")).toBeDisabled();
});
