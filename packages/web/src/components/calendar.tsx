// The calendar's parts (#33, D · Plan from spike #31): the month grid on ink with an 8th week
// column, the day square (lime by how the day sat against its goal's on-plan range, a cap for
// the direction, a hollow cap for too low, grey for kcal without a goal or meals not analysed,
// darker for nothing logged), the selected day continuing on the same ink, the month summary
// with the weight's 7-day average on tint, and the legend in words on the page.
import { Link } from "@tanstack/react-router";
import {
  addDays,
  type Classification,
  classifyDay,
  classifyWeek,
  DEAD_ZONE,
  dayInput,
  FAR_OFF,
  type MonthDay,
  type MonthResponse,
  type MonthWeek,
  monthDays,
  type PlanGoal,
  planWords,
  rangeWords,
  TOO_LOW_ON_CUT,
  WEEK_FULL_DAYS,
  weekdayIndex,
} from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, Square } from "lucide-react";
import type * as React from "react";
import { Fragment } from "react";
import {
  dateStart,
  dayLabel,
  formatKg,
  formatMonth,
  formatNumber,
  formatShortDate,
  plural,
} from "@/lib/format";
import { Band, Label } from "./slab";
import { TotalsSlab } from "./totals-slab";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** The fills on the ink slab: three lime strengths for the plan, greys for the rest. */
const fill = {
  on: "bg-lime text-lime-foreground",
  just: "bg-lime/55 text-ink-foreground",
  far: "bg-lime/25 text-ink-foreground dark:bg-lime/35",
  /** kcal without a goal to judge them by, or meals not analysed yet */
  kcal: "bg-ink-line text-ink-foreground",
  /** nothing logged, and the future */
  empty: "bg-ink-line/40 text-ink-muted",
} as const;

/** How a day looks: the classification, else kcal only, not analysed, or nothing. */
interface DayLook {
  c: Classification;
  fill: string;
  words: string;
}

function lookOf(day: MonthDay | undefined): DayLook {
  const c = classifyDay(dayInput(day?.totals?.nutrients.energyKcal ?? null, day?.goal ?? null));
  if (c.band !== "none") return { c, fill: fill[c.band], words: planWords(c) };
  if (day?.totals) {
    const why = day.goal ? "no kcal target" : "no goal";
    return { c, fill: fill.kcal, words: `${formatNumber(day.totals.nutrients.energyKcal)} kcal, ${why}` };
  }
  if (day?.unanalysed) return { c, fill: fill.kcal, words: "not analysed yet" };
  return { c, fill: fill.empty, words: "nothing logged" };
}

/** The direction caps: a bar on top for over, below for under, a hollow one below for too low. */
function Caps({ c, inset }: { c: Classification; inset: boolean }) {
  const x = inset ? "inset-x-[3px]" : "inset-x-0";
  if (c.tooLow) {
    return (
      <span
        className={cn(
          "absolute h-[7px] border-2 border-ink-foreground",
          x,
          inset ? "bottom-[5px]" : "bottom-0",
        )}
        data-cap="too-low"
        aria-hidden
      />
    );
  }
  if (!c.direction) return null;
  return (
    <span
      className={cn(
        "absolute h-1 bg-ink-foreground",
        x,
        c.direction === "over" ? (inset ? "top-[5px]" : "top-0") : inset ? "bottom-[5px]" : "bottom-0",
      )}
      data-cap={c.direction}
      aria-hidden
    />
  );
}

function DaySquare({
  date,
  day,
  today,
  selected,
  onSelect,
}: {
  date: string;
  day: MonthDay | undefined;
  today: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const future = date > today;
  const look = future ? { c: classifyDay(null), fill: fill.empty, words: "" } : lookOf(day);
  const kcalOnly = look.c.band === "none" && !!day?.totals;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={future}
      aria-pressed={selected}
      aria-label={`${formatShortDate(date)}${look.words ? `, ${look.words}` : ""}`}
      className={cn(
        "relative flex h-12 min-w-11 items-start justify-start overflow-hidden p-1 outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-lime focus-visible:ring-inset",
        look.fill,
        selected && "ring-[3px] ring-ink-foreground ring-inset",
      )}
      data-testid="day-square"
      data-date={date}
      data-band={future ? "future" : look.c.band}
      data-direction={look.c.direction ?? ""}
      data-too-low={look.c.tooLow}
    >
      <Caps c={look.c} inset={selected} />
      <span
        className={cn(
          "flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
          date === today && "bg-ink-foreground text-ink",
          future && "opacity-40",
        )}
      >
        {Number(date.slice(8))}
      </span>
      {!future && !!day?.unanalysed && (
        <span
          className={cn(
            "absolute right-1.5 size-2 bg-current",
            // above a cap at the bottom (under, too low)
            look.c.tooLow || look.c.direction === "under"
              ? selected
                ? "bottom-4"
                : "bottom-3"
              : "bottom-1.5",
          )}
          data-testid="not-analysed"
        />
      )}
      {kcalOnly && !day?.unanalysed && (
        <span className="absolute right-1 bottom-1 font-bold text-[10px] text-ink-muted">
          {(day.totals!.nutrients.energyKcal / 1000).toFixed(1)}k
        </span>
      )}
    </button>
  );
}

/** The week column: the week's mean with the same encoding, the count when fewer than four days counted. */
function WeekSquare({ week }: { week: MonthWeek | undefined }) {
  const w = classifyWeek(week?.days ?? []);
  const few = w.days > 0 && w.days < WEEK_FULL_DAYS;
  return (
    <div
      role="img"
      aria-label={`Week: ${w.days ? `${planWords(w)}, over ${plural(w.days, "day")}` : "nothing to average"}`}
      className={cn(
        "relative flex h-12 items-center justify-center overflow-hidden",
        w.band === "none" ? fill.empty : fill[w.band],
      )}
      data-testid="week-square"
      data-band={w.band}
      data-days={w.days}
    >
      <Caps c={w} inset={false} />
      {few && <span className="font-bold text-[11px] leading-none">{w.days}</span>}
    </div>
  );
}

/** Monday-first weeks of a month as dates (the neighbouring months' days pad the first and last). */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const last = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
  const weeks: string[][] = [];
  for (let d = addDays(first, -weekdayIndex(first)); d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
}

/**
 * The month on the ink slab: weekday labels, 7 day columns (≥ 44 px wide at 390), a thin gap and
 * the 24 px week column. Days outside the month stay blank; the future can't be picked.
 */
export function MonthGrid({
  month,
  data,
  today,
  selected,
  onSelect,
}: {
  month: string;
  data: MonthResponse | undefined;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const days = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const weeks = new Map((data?.weeks ?? []).map((w) => [w.start, w]));
  return (
    <Band tone="ink" className="px-3 pt-4 pb-4">
      <section
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr)) 0 24px" }}
        aria-label={`${formatMonth(month)} ${month.slice(0, 4)}`}
        data-testid="month-grid"
        data-month={month}
        data-loaded={!!data}
      >
        {WEEKDAYS.map((w) => (
          <Label key={w} className="pb-1 text-center text-[11px] text-ink-muted">
            {w}
          </Label>
        ))}
        <span />
        <Label className="pb-1 text-center text-[11px] text-ink-muted">Wk</Label>
        {monthGrid(month).map((week) => (
          <Fragment key={week[0]}>
            {week.map((date) =>
              date.startsWith(month) ? (
                <DaySquare
                  key={date}
                  date={date}
                  day={days.get(date)}
                  today={today}
                  selected={date === selected}
                  onSelect={() => onSelect(date)}
                />
              ) : (
                <div key={date} />
              ),
            )}
            <span />
            {week[0]! > today ? <div /> : <WeekSquare week={weeks.get(week[0]!)} />}
          </Fragment>
        ))}
      </section>
    </Band>
  );
}

/**
 * The selected day, continuing the month's ink: its name, goal and meals as a row to the day
 * view, then the totals slab with left / over per target, the meals not counted yet and the
 * day's plan reading.
 */
export function SelectedDay({ day, today, now }: { day: MonthDay | undefined; today: string; now: number }) {
  if (!day) return <Band tone="ink" className="h-16" />;
  const look = lookOf(day);
  const recent = (dateStart(today) - dateStart(day.date)) / 86_400_000 < 7;
  const plan = look.c.band !== "none" ? capitalise(look.words) : null;
  return (
    <Band tone="ink" data-testid="selected-day">
      <Link
        to="/days/$date"
        params={{ date: day.date }}
        className="flex min-h-16 items-center justify-between gap-3 border-ink-line border-t px-5 py-2 outline-none active:opacity-70 focus-visible:underline"
        data-testid="selected-day-row"
      >
        <span className="min-w-0">
          <span className="block font-bold">
            {dayLabel(dateStart(day.date), now)}
            {recent && <span className="ml-2 text-ink-muted">{formatShortDate(day.date)}</span>}
          </span>
          <Label className="mt-0.5 block text-ink-muted">
            {day.goal ? day.goal.label : "No goal"}
            {" · "}
            {day.meals ? plural(day.meals, "meal") : "nothing logged"}
          </Label>
        </span>
        <Label className="flex shrink-0 items-center gap-1 text-ink-muted">
          Open day <ArrowRight className="size-4" strokeWidth={2.5} />
        </Label>
      </Link>
      <TotalsSlab
        className="pt-2"
        totals={day.totals}
        label={day.date === today ? "kcal today" : `kcal · ${formatShortDate(day.date)}`}
        targets={day.goal?.targets}
        showLeft
        data-testid="selected-totals"
        note={
          day.unanalysed ? (
            <>
              <Square className="size-2.5 fill-current" strokeWidth={0} />
              {plural(day.unanalysed, "meal")} not counted yet
              {plan && <span className="ml-auto">{plan}</span>}
            </>
          ) : plan ? (
            <span data-testid="plan-words">{plan}</span>
          ) : day.totals && !day.goal ? (
            "No targets for this day"
          ) : day.totals && !day.goal?.targets.energyKcal ? (
            "No kcal target for this day"
          ) : undefined
        }
      />
    </Band>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({
  value,
  unit,
  label,
  testId,
}: {
  value: string;
  unit: string;
  label: string;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline gap-0.5">
        <span className="display text-[26px]">{value}</span>
        <span className="font-bold text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <Label className="mt-1.5 text-[11px] text-muted-foreground">{label}</Label>
    </div>
  );
}

/** The month so far on tint: days tracked, the mean share of the kcal target, averages, the weight. */
export function MonthSummary({
  month,
  data,
  current,
  error,
}: {
  month: string;
  data: MonthResponse | undefined;
  current: boolean;
  error: boolean;
}) {
  const s = data?.summary;
  const targets = s?.goal?.targets;
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="month-summary">
      <div className="flex items-end justify-between gap-3">
        <h2 className="display text-[22px]">{current ? "So far this month" : formatMonth(month)}</h2>
        {s && (
          <Label className="text-muted-foreground" data-testid="days-tracked">
            {s.tracked} of {plural(s.days, "day")}
          </Label>
        )}
      </div>
      {error && !data ? (
        <p className="mt-3 font-medium text-muted-foreground">Can't reach yamt right now.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat
              testId="kcal-share"
              value={s?.kcalShare == null ? "—" : String(Math.round(s.kcalShare * 100))}
              unit="%"
              label="of kcal target"
            />
            <Stat
              testId="avg-kcal"
              value={s?.avgKcal == null ? "—" : formatNumber(s.avgKcal)}
              unit={targets?.energyKcal ? `/${formatNumber(targets.energyKcal)}` : "kcal"}
              label="avg kcal"
            />
            <Stat
              testId="avg-protein"
              value={s?.avgProtein == null ? "—" : formatNumber(s.avgProtein)}
              unit={targets?.protein ? `/${formatNumber(targets.protein)}` : "g"}
              label="avg protein"
            />
          </div>
          {data && <WeightLine month={month} data={data} />}
        </>
      )}
    </Band>
  );
}

const W = 350;
const H = 72;

/** The 7-day weight average across the month: a 2.5 px line in the foreground, the days' weights as small squares. */
function WeightLine({ month, data }: { month: string; data: MonthResponse }) {
  const pts = data.weight;
  if (pts.length === 0) {
    return (
      <p className="mt-4 border-border border-t pt-3 font-medium text-muted-foreground text-sm">
        No weight logged this month.
      </p>
    );
  }
  const n = monthDays(month);
  const x = (date: string) => 4 + ((Number(date.slice(8)) - 1) / (n - 1)) * (W - 8);
  const values = pts.flatMap((p) => [p.kg, p.avg]);
  let lo = Math.min(...values) - 0.2;
  let hi = Math.max(...values) + 0.2;
  // at least 2 kg tall, so day-to-day noise doesn't look like a cliff
  if (hi - lo < 2) {
    const mid = (hi + lo) / 2;
    lo = mid - 1;
    hi = mid + 1;
  }
  const y = (kg: number) => 6 + ((hi - kg) / (hi - lo)) * (H - 12);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
  const first = pts[0]!;
  const last = pts.at(-1)!;
  const lastDate = `${month}-${n}`;
  const end = [data.today, lastDate].sort()[0]!; // today in the current month
  const short = formatMonth(month).slice(0, 3);
  return (
    <div className="mt-4 border-border border-t pt-3" data-testid="month-weight">
      <div className="flex items-baseline justify-between">
        <Label className="text-muted-foreground">Weight · 7-day avg</Label>
        <span className="font-bold text-sm">
          {pts.length > 1 ? `${formatKg(first.avg)} → ${formatKg(last.avg)}` : formatKg(last.avg)}
          <span className="ml-1 font-bold text-muted-foreground text-xs">kg</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 block h-[72px] w-full"
        role="img"
        aria-label={`Weight's 7-day average this month, ${formatKg(first.avg)} to ${formatKg(last.avg)} kg`}
      >
        {pts.map((p) => (
          <rect
            key={p.date}
            x={x(p.date) - 2}
            y={y(p.kg) - 2}
            width={4}
            height={4}
            fill="var(--muted-foreground)"
            opacity={0.6}
          />
        ))}
        {pts.length > 1 && (
          <path
            d={path}
            fill="none"
            stroke="var(--foreground)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="flex justify-between">
        <Label className="text-[11px] text-muted-foreground">1 {short}</Label>
        <Label className="text-[11px] text-muted-foreground">
          {Number(end.slice(8))} {short}
        </Label>
      </div>
    </div>
  );
}

/** The goals in force on the days so far, in order, each with the first day it applies (null: no goal). */
function goalSpans(days: readonly MonthDay[]): { goal: PlanGoal | null; from: string }[] {
  const out: { goal: PlanGoal | null; from: string }[] = [];
  for (const d of days) {
    if (out.at(-1)?.goal?.id === d.goal?.id && out.length) continue;
    out.push({ goal: d.goal, from: d.date });
  }
  return out;
}

/** The range for the goals in force this month, in words. */
function rangeSentences(days: readonly MonthDay[]): string[] {
  const spans = goalSpans(days);
  if (spans.every((s) => !s.goal)) return ["No goal this month: the squares show kcal only."];
  return spans.map(({ goal, from }, i) => {
    const next = spans[i + 1];
    const when =
      spans.length === 1
        ? ""
        : !goal && next
          ? `Until ${formatShortDate(addDays(next.from, -1))}: `
          : `From ${formatShortDate(from)}: `;
    if (!goal) return `${when}no goal, kcal only.`;
    if (!goal.targets.energyKcal) return `${when}${goal.label}, no kcal target: kcal only.`;
    return `${when}${goal.label}, ${rangeWords(goal.kind ?? "maintain")}.`;
  });
}

function Swatch({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden bg-ink">
      <span className={cn("absolute inset-[3px] overflow-hidden", className)}>{children}</span>
    </span>
  );
}

/**
 * "Reading the month" on the plain page: the goals' ranges in words, then each mark on a small
 * piece of the ink slab, so the swatches look like the squares.
 */
export function Legend({ data }: { data: MonthResponse | undefined }) {
  if (!data) return null;
  const soFar = data.days.filter((d) => d.date <= data.today);
  const days = soFar.length ? soFar : data.days.slice(0, 1);
  const planned = days.some((d) => d.goal?.targets.energyKcal);
  const unplanned = days.some((d) => !d.goal?.targets.energyKcal);
  const far = pct(FAR_OFF);
  const rows: [string, React.ReactNode, string][] = [
    ...(planned
      ? ([
          ["on", <Swatch key="on" className={fill.on} />, "on plan"],
          ["just", <Swatch key="just" className={fill.just} />, `just off: outside the range, within ${far}`],
          ["far", <Swatch key="far" className={fill.far} />, `far off: beyond ${far}`],
          [
            "over",
            <Swatch key="over" className={fill.on}>
              <span className="absolute inset-x-0 top-0 h-[3px] bg-ink-foreground" />
            </Swatch>,
            "over the target (a cap on top)",
          ],
          [
            "under",
            <Swatch key="under" className={fill.on}>
              <span className="absolute inset-x-0 bottom-0 h-[3px] bg-ink-foreground" />
            </Swatch>,
            `under the target (a cap below); none within ${pct(DEAD_ZONE)}`,
          ],
          [
            "low",
            <Swatch key="low" className={fill.far}>
              <span className="absolute inset-x-0 bottom-0 h-[6px] border-2 border-ink-foreground" />
            </Swatch>,
            `too low: under the calorie floor, or over ${pct(TOO_LOW_ON_CUT)} under on a cut`,
          ],
        ] as [string, React.ReactNode, string][])
      : []),
    ...(unplanned
      ? ([
          [
            "kcal",
            <Swatch key="kcal" className={fill.kcal}>
              <span className="absolute right-px bottom-px font-bold text-[8px] text-ink-muted leading-none">
                2k
              </span>
            </Swatch>,
            "no goal to judge by: the kcal, in thousands",
          ],
        ] as [string, React.ReactNode, string][])
      : []),
    [
      "pending",
      <Swatch key="pending" className={fill.kcal}>
        <span className="absolute right-0.5 bottom-0.5 size-1.5 bg-ink-foreground" />
      </Swatch>,
      "meals not analysed yet",
    ],
    ["empty", <Swatch key="empty" className={fill.empty} />, "nothing logged"],
    [
      "week",
      <Swatch key="week" className={cn(fill.on, "flex items-center justify-center")}>
        <span className="font-bold text-[10px] leading-none">3</span>
      </Swatch>,
      `the last column is the week: its average over the analysed days, the count when fewer than ${WEEK_FULL_DAYS}`,
    ],
  ];
  return (
    <section className="px-5 pt-5 pb-6" data-testid="calendar-legend">
      <h2 className="display text-[22px]">Reading the month</h2>
      {rangeSentences(days).map((t) => (
        <p key={t} className="mt-2 font-bold" data-testid="legend-range">
          {t}
        </p>
      ))}
      <ul className="mt-4 grid grid-cols-1 gap-y-2">
        {rows.map(([key, swatch, text]) => (
          <li key={key} className="flex items-center gap-3">
            {swatch}
            <span className="font-medium text-muted-foreground text-sm">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
