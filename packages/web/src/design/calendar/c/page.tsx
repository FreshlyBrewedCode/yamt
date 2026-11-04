// Variant C · Heat: the month itself is the ink slab. Each day is a square whose lime strength
// says how close the day came to its kcal target (within 10 %, within 25 %, further off), a
// paper cap on top says it went over, so the picture reads at arm's length. The selected day is
// a plain row under the slab with the way into the day view; the summary on tint carries the
// month's numbers and the weight's 7-day average as a small chart. Months step in the header.
import { Link, useNavigate } from "@tanstack/react-router";
import { addDays } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BackButton, Band, BottomSlab, Label, SlabButton } from "@/components/slab";
import { dateStart, dayLabel, formatKg, formatNumber, formatShortDate, plural } from "@/lib/format";
import {
  addMonths,
  dayOf,
  FIRST_MONTH,
  goalFor,
  inMonth,
  kcalShare,
  LAST_MONTH,
  lastShown,
  type MockDay,
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

export function CalendarC({
  month,
  day,
  onMonth,
  onDay,
}: {
  month: string;
  day: string;
  onMonth: (m: string) => void;
  onDay: (d: string) => void;
}) {
  const navigate = useNavigate();
  const weeks = monthWeeks(month);
  const s = monthSummary(month);
  const selected = dayOf(day);
  const goal = goalFor(day);
  const share = kcalShare(selected);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const label = dayLabel(dateStart(day), NOW);
  // "Today", "Yesterday" and weekdays get the date next to them; older days already are one
  const recent = (dateStart(TODAY) - dateStart(day)) / 86_400_000 < 7;

  return (
    <>
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

      <main className="flex-1">
        {/* the one thing on this screen: the month */}
        <Band tone="ink" className="px-5 pt-4 pb-5" aria-label={`${monthName(month)} ${yearOf(month)}`}>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <Label key={w} className="pb-1 text-center text-[11px] text-ink-muted">
                {w}
              </Label>
            ))}
            {weeks
              .flat()
              .map((date) =>
                inMonth(date, month) ? (
                  <Square
                    key={date}
                    date={date}
                    day={dayOf(date)}
                    selected={date === day}
                    onSelect={() => onDay(date)}
                  />
                ) : (
                  <div key={date} />
                ),
              )}
          </div>
          <Legend />
        </Band>

        {/* the selected day, and the way in */}
        <Link
          to="/days/$date"
          params={{ date: day }}
          className="flex min-h-[72px] items-center justify-between gap-3 px-5 outline-none active:bg-tint focus-visible:underline"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              {label}
              {recent && <span className="ml-2 text-muted-foreground">{formatShortDate(day, NOW)}</span>}
            </span>
            <span className="mt-0.5 block font-medium text-muted-foreground text-sm">
              {selected?.totals
                ? `${formatNumber(selected.totals.energyKcal)}${goal?.targets.energyKcal ? ` / ${formatNumber(goal.targets.energyKcal)}` : ""} kcal · ${formatNumber(selected.totals.protein)}${goal?.targets.protein ? ` / ${goal.targets.protein}` : ""} g protein${selected.pending ? ` · ${plural(selected.pending, "meal")} not counted yet` : ""}`
                : selected?.meals
                  ? `${plural(selected.meals, "meal")} not analysed yet`
                  : "Nothing logged on this day"}
            </span>
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            {share !== null && (
              <span className="display text-[26px]">
                {Math.round(share * 100)}
                <span className="ml-0.5 font-bold text-muted-foreground text-xs">%</span>
              </span>
            )}
            <ArrowRight className="size-5 self-center text-muted-foreground" strokeWidth={2.5} />
          </span>
        </Link>

        {/* the month so far on tint, with the weight's 7-day average */}
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
      </main>

      <BottomSlab>
        <SlabButton tone="tint" onClick={() => navigate({ to: "/days/$date", params: { date: day } })}>
          Open {label} <ArrowRight className="size-7" strokeWidth={2.5} />
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/** The lime strength for a kcal share: how far from the target, in either direction. */
function heat(share: number | null): "near" | "mid" | "far" | null {
  if (share === null) return null;
  const off = Math.abs(share - 1);
  return off <= 0.1 ? "near" : off <= 0.25 ? "mid" : "far";
}

function Square({
  date,
  day,
  selected,
  onSelect,
}: {
  date: string;
  day: MockDay | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const share = kcalShare(day);
  const h = heat(share);
  const over = share !== null && share > 1;
  const isToday = date === TODAY;
  const future = date > TODAY;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={future}
      aria-pressed={selected}
      aria-label={`${formatShortDate(date, NOW)}${share !== null ? `, ${Math.round(share * 100)} % of the kcal target` : day?.meals ? ", not analysed yet" : ", nothing logged"}`}
      className={cn(
        "relative flex aspect-square items-start justify-start overflow-hidden p-1 outline-none",
        h === "near" && "bg-lime text-lime-foreground",
        h === "mid" && "bg-lime/55 text-ink-foreground",
        h === "far" && "bg-lime/25 text-ink-foreground",
        h === null && day?.meals && "bg-ink-line",
        h === null && !day?.meals && "bg-ink-line/40",
        selected && "ring-[3px] ring-ink-foreground ring-inset",
      )}
    >
      {over && <span className="absolute inset-x-0 top-0 h-1 bg-ink-foreground" aria-hidden />}
      <span
        className={cn(
          "flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
          isToday && "bg-ink-foreground text-ink",
          !isToday && h === null && !day?.meals && "text-ink-muted",
          !isToday && future && "text-ink-muted/50",
        )}
      >
        {Number(date.slice(8))}
      </span>
      {day && day.pending > 0 && (
        <span className="absolute right-1.5 bottom-1.5 size-2 bg-current" aria-hidden />
      )}
    </button>
  );
}

function Legend() {
  const items: [string, string][] = [
    ["bg-lime", "within 10 %"],
    ["bg-lime/55", "within 25 %"],
    ["bg-lime/25", "further off"],
    ["bg-ink-line", "not analysed"],
    ["bg-ink-line/40", "nothing logged"],
  ];
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-ink-line border-t pt-3">
      {items.map(([fill, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          <span className={cn("size-3", fill)} />
          <Label className="text-[11px] text-ink-muted">{text}</Label>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="relative size-3 bg-lime">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-ink-foreground" />
        </span>
        <Label className="text-[11px] text-ink-muted">over</Label>
      </li>
    </ul>
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
  const line = pts
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
          d={line}
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
