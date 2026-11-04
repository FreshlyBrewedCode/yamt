// Round 2 of spike #31: the parts D and E share. The month grid with an 8th week column, the
// day square (lime by how close the day sat to its goal's on-plan range, a cap for the
// direction, a hollow cap for too low, grey for not analysed, darker for nothing logged), the
// legend in plain words, the month summary with the weight's 7-day average, and the selected
// day's totals (A's ink slab) with its goal label. Every part takes the surface it sits on:
// D draws the month on ink, E on tint.
import { Link } from "@tanstack/react-router";
import { addDays } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BackButton, Band, Label } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import { dateStart, dayLabel, formatKg, formatNumber, formatShortDate, plural } from "@/lib/format";
import {
  addMonths,
  asTotals,
  dayOf,
  FIRST_MONTH,
  goalFor,
  goals,
  inMonth,
  LAST_MONTH,
  lastShown,
  type MockDay,
  type MockGoal,
  monthEnd,
  monthName,
  monthStart,
  monthSummary,
  monthWeeks,
  NOW,
  TODAY,
  WEEKDAYS,
  weightAvg,
  yearOf,
} from "../mock";
import { type Classification, classifyDay, classifyWeek, type DayInput, rangeWords } from "../plan";

export type Surface = "ink" | "tint";

/** What the classifier needs of a mock day; null when it has nothing to classify. */
export function dayInput(day: MockDay | undefined): DayInput | null {
  if (!day?.totals) return null;
  const goal = goalFor(day.date);
  return {
    kcal: day.totals.energyKcal,
    target: goal?.targets.energyKcal ?? null,
    goalKind: goal?.kind ?? null,
    floor: goal?.floorKcal ?? null,
  };
}

// ---- the fills, per surface ----

const fill: Record<Surface, Record<"on" | "just" | "far" | "kcal" | "pending" | "empty", string>> = {
  ink: {
    on: "bg-lime text-lime-foreground",
    just: "bg-lime/55 text-ink-foreground",
    far: "bg-lime/25 text-ink-foreground dark:bg-lime/35",
    kcal: "bg-ink-line text-ink-foreground",
    pending: "bg-ink-line text-ink-foreground",
    empty: "bg-ink-line/40 text-ink-muted",
  },
  tint: {
    on: "bg-lime text-lime-foreground",
    just: "bg-lime/65 text-foreground",
    far: "bg-lime/35 text-foreground",
    kcal: "bg-foreground/10 text-foreground",
    pending: "bg-foreground/10 text-foreground",
    empty: "bg-foreground/5 text-muted-foreground",
  },
};
/** The caps, the today chip and the selected frame: the surface's own foreground. */
const mark: Record<Surface, string> = { ink: "bg-ink-foreground", tint: "bg-foreground" };
const markBorder: Record<Surface, string> = { ink: "border-ink-foreground", tint: "border-foreground" };
const ring: Record<Surface, string> = { ink: "ring-ink-foreground", tint: "ring-foreground" };
const chip: Record<Surface, string> = {
  ink: "bg-ink-foreground text-ink",
  tint: "bg-foreground text-background",
};
const muted: Record<Surface, string> = { ink: "text-ink-muted", tint: "text-muted-foreground" };
const line: Record<Surface, string> = { ink: "border-ink-line", tint: "border-border" };

function fillFor(surface: Surface, c: Classification | null, day: MockDay | undefined): string {
  if (c && c.band !== "none") return fill[surface][c.band];
  if (day?.totals) return fill[surface].kcal; // numbers, no goal
  if (day?.meals) return fill[surface].pending;
  return fill[surface].empty;
}

/** The direction caps: a bar at the top for over, at the bottom for under, hollow for too low. */
function Caps({ c, surface, inset }: { c: Classification; surface: Surface; inset: boolean }) {
  const x = inset ? "inset-x-[3px]" : "inset-x-0";
  if (c.tooLow) {
    return (
      <span
        className={cn(
          "absolute h-[7px] border-2 bg-transparent",
          x,
          inset ? "bottom-[5px]" : "bottom-0",
          markBorder[surface],
        )}
        aria-hidden
      />
    );
  }
  if (c.direction === "over") {
    return (
      <span className={cn("absolute h-1", x, inset ? "top-[5px]" : "top-0", mark[surface])} aria-hidden />
    );
  }
  if (c.direction === "under") {
    return (
      <span
        className={cn("absolute h-1", x, inset ? "bottom-[5px]" : "bottom-0", mark[surface])}
        aria-hidden
      />
    );
  }
  return null;
}

function describe(c: Classification | null, day: MockDay | undefined): string {
  if (c && c.band !== "none") {
    const band = c.band === "on" ? "on plan" : c.band === "just" ? "just off" : "far off";
    const dir = c.tooLow ? ", too low" : c.direction ? `, ${c.direction}` : "";
    return `${band}${dir}`;
  }
  if (day?.totals) return `${formatNumber(day.totals.energyKcal)} kcal, no goal`;
  if (day?.meals) return "not analysed yet";
  return "nothing logged";
}

export function Square({
  date,
  day,
  selected,
  onSelect,
  surface,
}: {
  date: string;
  day: MockDay | undefined;
  selected: boolean;
  onSelect: () => void;
  surface: Surface;
}) {
  const input = dayInput(day);
  const c = input ? classifyDay(input) : null;
  const isToday = date === TODAY;
  const future = date > TODAY;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={future}
      aria-pressed={selected}
      aria-label={`${formatShortDate(date, NOW)}, ${describe(c, day)}`}
      className={cn(
        "relative flex h-12 items-start justify-start overflow-hidden p-1 outline-none",
        fillFor(surface, c, day),
        selected && cn("ring-[3px] ring-inset", ring[surface]),
      )}
    >
      {c && <Caps c={c} surface={surface} inset={selected} />}
      <span
        className={cn(
          "flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
          isToday && chip[surface],
          !isToday && future && "opacity-40",
        )}
      >
        {Number(date.slice(8))}
      </span>
      {day && day.pending > 0 && (
        <span className="absolute right-1.5 bottom-1.5 size-2 bg-current" aria-hidden />
      )}
      {day?.totals && (!c || c.band === "none") && (
        <span className={cn("absolute right-1 bottom-1 font-bold text-[10px]", muted[surface])}>
          {(day.totals.energyKcal / 1000).toFixed(1)}k
        </span>
      )}
    </button>
  );
}

/** The week column: the week's average with the same encoding; the count of counted days when fewer than four. */
export function WeekSquare({ dates, month, surface }: { dates: string[]; month: string; surface: Surface }) {
  const shown = dates.filter((d) => inMonth(d, month) && d <= TODAY);
  if (shown.length === 0) return <div />;
  const w = classifyWeek(shown.map((d) => dayInput(dayOf(d))));
  const few = w.days > 0 && w.days < 4;
  return (
    <div
      role="img"
      aria-label={`Week: ${w.days ? `${describe(w, undefined)} over ${plural(w.days, "day")}` : "nothing to average"}`}
      className={cn(
        "relative flex h-12 items-center justify-center overflow-hidden",
        w.band === "none" ? fill[surface].empty : fill[surface][w.band],
      )}
    >
      <Caps c={w} surface={surface} inset={false} />
      {few && <span className="font-bold text-[11px] leading-none">{w.days}</span>}
    </div>
  );
}

/** The month grid: weekday labels, 7 day columns, a thin gap, the week column. */
export function MonthGrid({
  month,
  day,
  onDay,
  surface,
}: {
  month: string;
  day: string;
  onDay: (d: string) => void;
  surface: Surface;
}) {
  const weeks = monthWeeks(month);
  return (
    <section
      className="grid gap-1"
      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr)) 8px 28px" }}
      aria-label={`${monthName(month)} ${yearOf(month)}`}
    >
      {WEEKDAYS.map((w) => (
        <Label key={w} className={cn("pb-1 text-center text-[11px]", muted[surface])}>
          {w}
        </Label>
      ))}
      <span />
      <Label className={cn("pb-1 text-center text-[11px]", muted[surface])}>Wk</Label>
      {weeks.map((week) => (
        <Row key={week[0]} week={week} month={month} day={day} onDay={onDay} surface={surface} />
      ))}
    </section>
  );
}

function Row({
  week,
  month,
  day,
  onDay,
  surface,
}: {
  week: string[];
  month: string;
  day: string;
  onDay: (d: string) => void;
  surface: Surface;
}) {
  return (
    <>
      {week.map((date) =>
        inMonth(date, month) ? (
          <Square
            key={date}
            date={date}
            day={dayOf(date)}
            selected={date === day}
            onSelect={() => onDay(date)}
            surface={surface}
          />
        ) : (
          <div key={date} />
        ),
      )}
      <span />
      <WeekSquare dates={week} month={month} surface={surface} />
    </>
  );
}

// ---- the legend ----

/** The goals in force during the month, oldest first, with the day each starts within it. */
function goalsInMonth(month: string): { goal: MockGoal; from: string }[] {
  const out: { goal: MockGoal; from: string }[] = [];
  const first = monthStart(month);
  const last = lastShown(month);
  const starting = goals.filter((g) => g.effectiveFrom > first && g.effectiveFrom <= last);
  const atStart = goalFor(first);
  if (atStart) out.push({ goal: atStart, from: first });
  for (const g of [...starting].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))) {
    out.push({ goal: g, from: g.effectiveFrom });
  }
  return out;
}

/** The range for the goal(s) in force this month, in words. */
function rangeSentences(month: string): string[] {
  const list = goalsInMonth(month);
  const first = monthStart(month);
  if (list.length === 0) return ["No goal this month: squares show kcal only."];
  const noGoalStart = !goalFor(first);
  const out: string[] = [];
  if (noGoalStart) out.push(`Until ${formatShortDate(addDays(list[0]!.from, -1), NOW)}: no goal, kcal only.`);
  for (const { goal, from } of list) {
    const when = list.length > 1 || noGoalStart ? `From ${formatShortDate(from, NOW)}: ` : "";
    const range = goal.kind ? rangeWords(goal.kind) : "targets set by hand, no range";
    out.push(`${when}${goal.label}, ${range}.`);
  }
  return out;
}

function Swatch({
  surface,
  className,
  children,
}: {
  surface: Surface;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center overflow-hidden",
        surface === "ink" ? "bg-ink" : "bg-tint",
      )}
    >
      <span className={cn("absolute inset-[3px]", className)}>{children}</span>
    </span>
  );
}

/**
 * The legend on the plain page: the goal's range in words, the three lime strengths, the caps,
 * the week column. Its swatches sit on the grid's own surface, so they look like the squares.
 */
export function Legend({ month, surface }: { month: string; surface: Surface }) {
  const f = fill[surface];
  const rows: [React.ReactNode, string][] = [
    [<Swatch key="on" surface={surface} className={f.on} />, "on plan"],
    [<Swatch key="just" surface={surface} className={f.just} />, "just off: outside the range, within 25 %"],
    [<Swatch key="far" surface={surface} className={f.far} />, "far off: beyond 25 %"],
    [
      <Swatch key="over" surface={surface} className={f.on}>
        <span className={cn("absolute inset-x-0 top-0 h-[3px]", mark[surface])} />
      </Swatch>,
      "over the target (a cap on top)",
    ],
    [
      <Swatch key="under" surface={surface} className={f.on}>
        <span className={cn("absolute inset-x-0 bottom-0 h-[3px]", mark[surface])} />
      </Swatch>,
      "under the target (a cap below); none within 5 %",
    ],
    [
      <Swatch key="low" surface={surface} className={f.far}>
        <span className={cn("absolute inset-x-0 bottom-0 h-[6px] border-2", markBorder[surface])} />
      </Swatch>,
      "too low: under the calorie floor, or over 25 % under on a cut",
    ],
    [
      <Swatch key="pending" surface={surface} className={f.pending}>
        <span className="absolute right-0.5 bottom-0.5 size-1.5 bg-current" />
      </Swatch>,
      "meals not analysed yet",
    ],
    [<Swatch key="empty" surface={surface} className={f.empty} />, "nothing logged"],
    [
      <Swatch key="week" surface={surface} className={cn(f.on, "flex items-center justify-center")}>
        <span className="font-bold text-[10px] leading-none">3</span>
      </Swatch>,
      "the last column is the week: its average over the analysed days, the count when fewer than 4",
    ],
  ];
  return (
    <section className="px-5 pt-5 pb-6">
      <h2 className="display text-[22px]">Reading the month</h2>
      {rangeSentences(month).map((t) => (
        <p key={t} className="mt-2 font-bold">
          {t}
        </p>
      ))}
      <ul className="mt-4 grid grid-cols-1 gap-y-2">
        {rows.map(([swatch, text]) => (
          <li key={text} className="flex items-center gap-3">
            {swatch}
            <span className="font-medium text-muted-foreground text-sm">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- the header, the selected day, the summary ----

export function Header({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <header className="px-5 pt-5 pb-4">
      <div className="flex items-center justify-between">
        <BackButton />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onMonth(prev)}
            disabled={prev < FIRST_MONTH}
            aria-label="Previous month"
            className="flex size-12 items-center justify-center bg-tint outline-none active:opacity-70 disabled:text-muted-foreground/40"
          >
            <ChevronLeft className="size-6" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => onMonth(next)}
            disabled={next > LAST_MONTH}
            aria-label="Next month"
            className="flex size-12 items-center justify-center bg-tint outline-none active:opacity-70 disabled:text-muted-foreground/40"
          >
            <ChevronRight className="size-6" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <Label className="mt-4 text-muted-foreground">Calendar · {yearOf(month)}</Label>
      <h1 className="display mt-1 text-[36px]">{monthName(month)}</h1>
    </header>
  );
}

/** The selected day's name, its goal and meals, and the way in: a row on `surface`. */
export function DayRow({ day, surface }: { day: string; surface: Surface }) {
  const selected = dayOf(day);
  const goal = goalFor(day);
  const label = dayLabel(dateStart(day), NOW);
  const recent = (dateStart(TODAY) - dateStart(day)) / 86_400_000 < 7;
  return (
    <Link
      to="/days/$date"
      params={{ date: day }}
      className={cn(
        "flex min-h-16 items-center justify-between gap-3 px-5 py-2 outline-none active:opacity-70 focus-visible:underline",
        surface === "ink" ? cn("border-t", line.ink) : "bg-tint",
      )}
    >
      <span className="min-w-0">
        <span className="block font-bold">
          {label}
          {recent && <span className={cn("ml-2", muted[surface])}>{formatShortDate(day, NOW)}</span>}
        </span>
        <Label className={cn("mt-0.5 block", muted[surface])}>
          {goal ? goal.label : "no goal"}
          {" · "}
          {selected?.meals ? plural(selected.meals, "meal") : "nothing logged"}
        </Label>
      </span>
      <Label className={cn("flex shrink-0 items-center gap-1", muted[surface])}>
        Open day <ArrowRight className="size-4" strokeWidth={2.5} />
      </Label>
    </Link>
  );
}

/** A's ink totals slab for the selected day: kcal with left/over, the macros with left/over, the note. */
export function DayTotals({ day, className }: { day: string; className?: string }) {
  const selected = dayOf(day);
  const goal = goalFor(day);
  const input = dayInput(selected);
  const c = input ? classifyDay(input) : null;
  const plan =
    c && c.band !== "none"
      ? `${c.band === "on" ? "On plan" : c.band === "just" ? "Just off" : "Far off"}${c.tooLow ? ", too low" : c.direction ? `, ${c.direction}` : ""}`
      : null;
  return (
    <TotalsSlab
      className={className}
      totals={selected?.totals ? asTotals(selected.totals) : null}
      label={day === TODAY ? "kcal today" : `kcal · ${formatShortDate(day, NOW)}`}
      targets={goal?.targets}
      showLeft
      note={
        selected?.pending ? (
          <>
            <span className="size-2.5 bg-current" />
            {plural(selected.pending, "meal")} not counted yet
            {plan && <span className="ml-auto">{plan}</span>}
          </>
        ) : plan ? (
          plan
        ) : !goal && selected?.totals ? (
          "No targets for this day"
        ) : undefined
      }
    />
  );
}

function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-0.5">
        <span className="display text-[26px]">{value}</span>
        <span className="font-bold text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <Label className="mt-1.5 text-[11px] text-muted-foreground">{label}</Label>
    </div>
  );
}

/** The month so far on tint, with the weight's 7-day average (from C). */
export function Summary({ month }: { month: string }) {
  const s = monthSummary(month);
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5">
      <div className="flex items-end justify-between">
        <h2 className="display text-[22px]">
          {month === LAST_MONTH ? "So far this month" : monthName(month)}
        </h2>
        <Label className="text-muted-foreground">
          {s.tracked} of {s.daysSoFar} days
        </Label>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat
          value={s.avgKcalShare === null ? "—" : `${Math.round(s.avgKcalShare * 100)}`}
          unit="%"
          label="of kcal target"
        />
        <Stat
          value={s.avgKcal === null ? "—" : formatNumber(s.avgKcal)}
          unit={s.targets?.energyKcal ? `/${formatNumber(s.targets.energyKcal)}` : "kcal"}
          label="avg kcal"
        />
        <Stat
          value={s.avgProtein === null ? "—" : formatNumber(s.avgProtein)}
          unit={s.targets?.protein ? `/${s.targets.protein}` : "g"}
          label="avg protein"
        />
      </div>
      <WeightLine month={month} />
    </Band>
  );
}

const W = 350;
const H = 72;

/** The 7-day weight average across the month: a 2.5 px line, raw entries as 4 px squares. */
function WeightLine({ month }: { month: string }) {
  const first = monthStart(month);
  const last = lastShown(month);
  const n = Number(monthEnd(month).slice(8));
  const pts: { x: number; avg: number | null; raw: number | null }[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const i = Number(d.slice(8)) - 1;
    pts.push({ x: 4 + (i / (n - 1)) * (W - 8), avg: weightAvg(d), raw: dayOf(d)?.weightKg ?? null });
  }
  const values = pts.flatMap((p) => [p.avg, p.raw]).filter((v): v is number => v !== null);
  if (values.length < 3) {
    return <p className="mt-4 font-medium text-muted-foreground text-sm">No weight this month.</p>;
  }
  let lo = Math.min(...values) - 0.2;
  let hi = Math.max(...values) + 0.2;
  if (hi - lo < 2) {
    const mid = (hi + lo) / 2;
    lo = mid - 1;
    hi = mid + 1;
  }
  const y = (kg: number) => 6 + ((hi - kg) / (hi - lo)) * (H - 12);
  const linePath = pts
    .filter((p) => p.avg !== null)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${y(p.avg!).toFixed(1)}`)
    .join("");
  const from = pts.find((p) => p.avg !== null)?.avg ?? null;
  const to = pts.findLast((p) => p.avg !== null)?.avg ?? null;
  return (
    <div className="mt-4 border-border border-t pt-3">
      <div className="flex items-baseline justify-between">
        <Label className="text-muted-foreground">Weight · 7-day avg</Label>
        {from !== null && to !== null && (
          <span className="font-bold text-sm">
            {formatKg(from)} → {formatKg(to)}
            <span className="ml-1 font-bold text-muted-foreground text-xs">kg</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 block h-[72px] w-full"
        role="img"
        aria-label="Weight trend this month"
      >
        {pts.map((p) =>
          p.raw === null ? null : (
            <rect
              key={p.x}
              x={p.x - 2}
              y={y(p.raw) - 2}
              width={4}
              height={4}
              fill="var(--muted-foreground)"
              opacity={0.6}
            />
          ),
        )}
        <path
          d={linePath}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between">
        <Label className="text-[11px] text-muted-foreground">1 {monthName(month).slice(0, 3)}</Label>
        <Label className="text-[11px] text-muted-foreground">
          {Number(last.slice(8))} {monthName(month).slice(0, 3)}
        </Label>
      </div>
    </div>
  );
}
