// Variant A · Fill: a month grid where each day's tile fills with lime from the bottom up to its
// kcal share of the target; over the target the tile rescales like the totals slab's bar (the
// target where the lime ends, a 2 px gap, the excess in the foreground). The selected day is
// the ink tile and feeds the ink slab under the grid; the bottom slab steps through months.
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRight, ChevronLeft, ChevronRight, Scale } from "lucide-react";
import { BackButton, Band, BottomSlab, Label } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import { dateStart, dayLabel, formatKg, formatNumber, formatShortDate, plural } from "@/lib/format";
import {
  addMonths,
  asTotals,
  dayOf,
  FIRST_MONTH,
  goalFor,
  inMonth,
  kcalShare,
  LAST_MONTH,
  type MockDay,
  monthName,
  monthShortName,
  monthSummary,
  monthWeeks,
  NOW,
  TODAY,
  WEEKDAYS,
  yearOf,
} from "../mock";

export function CalendarA({
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
  const weeks = monthWeeks(month);
  const summary = monthSummary(month);
  const selected = dayOf(day);
  const goal = goalFor(day);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <Link
            to="/goals"
            className="flex size-12 items-center justify-center bg-tint"
            aria-label="Goals and weight"
          >
            <Scale className="size-6" strokeWidth={2.5} />
          </Link>
        </div>
        <Label className="mt-4 text-muted-foreground">
          {yearOf(month)} · {summary.tracked} of {summary.daysSoFar} days tracked
        </Label>
        <h1 className="display mt-1 text-[36px]">{monthName(month)}</h1>
      </header>

      <main className="flex-1">
        {/* the grid: weekday labels, then 2 px page-colour gaps between tint tiles */}
        <section className="px-5 pb-4" aria-label={`${monthName(month)} ${yearOf(month)}`}>
          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w) => (
              <Label key={w} className="pb-2 text-center text-[11px] text-muted-foreground">
                {w}
              </Label>
            ))}
            {weeks
              .flat()
              .map((date) =>
                inMonth(date, month) ? (
                  <Tile
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
        </section>

        {/* the selected day: its name and the way in, then its numbers on the ink slab */}
        <Link
          to="/days/$date"
          params={{ date: day }}
          className="flex min-h-14 items-center justify-between gap-3 bg-tint px-5 outline-none active:opacity-70 focus-visible:underline"
        >
          <span className="font-bold">
            {dayLabel(dateStart(day), NOW)}
            <span className="ml-2 font-bold text-muted-foreground text-xs uppercase tracking-[0.08em]">
              {selected?.meals ? plural(selected.meals, "meal") : "nothing logged"}
            </span>
          </span>
          <Label className="flex items-center gap-1 text-muted-foreground">
            Open day <ArrowRight className="size-4" strokeWidth={2.5} />
          </Label>
        </Link>
        <TotalsSlab
          totals={selected?.totals ? asTotals(selected.totals) : null}
          label={day === TODAY ? "kcal today" : `kcal · ${formatShortDate(day, NOW)}`}
          targets={goal?.targets}
          showLeft
          note={
            selected?.pending ? (
              <>
                <span className="size-2.5 bg-current" />
                {plural(selected.pending, "meal")} not counted yet
              </>
            ) : !goal && selected?.totals ? (
              "No targets for this day"
            ) : undefined
          }
        />

        <Summary month={month} />
      </main>

      {/* stepping through months is this screen's action, where the thumb is */}
      <BottomSlab>
        <Band tone="tint" className="grid grid-cols-2 divide-x divide-border">
          <MonthStep
            side="prev"
            label={`${monthShortName(prev)} ${yearOf(prev)}`}
            onClick={() => onMonth(prev)}
            disabled={prev < FIRST_MONTH}
          />
          <MonthStep
            side="next"
            label={`${monthShortName(next)} ${yearOf(next)}`}
            onClick={() => onMonth(next)}
            disabled={next > LAST_MONTH}
          />
        </Band>
      </BottomSlab>
    </>
  );
}

/**
 * One day: a tint tile (ink when selected) with the kcal share as a fill from the bottom. Over
 * the target, the lime stops at the target's share of the total and the excess sits above a
 * 2 px gap in the tile's own colour, filled in the foreground. A small square marks meals not
 * analysed yet; days without meals stay empty with a muted number; the future is quiet.
 */
function Tile({
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
  const isToday = date === TODAY;
  const future = date > TODAY;
  const scale = share === null ? 0 : Math.max(share, 1);
  const lime = share === null ? 0 : Math.min(share, 1) / scale;
  const over = share !== null && share > 1 ? (share - 1) / scale : 0;
  const n = Number(date.slice(8));
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={future}
      aria-label={`${formatShortDate(date, NOW)}${share !== null ? `, ${Math.round(share * 100)} % of the kcal target` : day?.meals ? ", not analysed yet" : ", nothing logged"}`}
      aria-pressed={selected}
      className={cn(
        "relative h-16 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset",
        selected ? "bg-ink text-ink-foreground" : "bg-tint",
      )}
    >
      {/* the fill stays under the number's strip: the excess in the tile's foreground, a 2 px gap, the lime */}
      <div className="absolute inset-x-0 top-7 bottom-0 flex flex-col justify-end" aria-hidden>
        {over > 0 && (
          <div
            className={cn("w-full", selected ? "bg-ink-foreground" : "bg-foreground")}
            style={{ height: `${over * 100}%` }}
          />
        )}
        {over > 0 && <div className={cn("h-0.5 w-full shrink-0", selected ? "bg-ink" : "bg-tint")} />}
        {lime > 0 && <div className="w-full bg-lime" style={{ height: `${lime * 100}%` }} />}
      </div>
      <span
        className={cn(
          "absolute top-1 left-1 flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
          isToday && (selected ? "bg-ink-foreground text-ink" : "bg-foreground text-background"),
          !isToday && !selected && !day?.meals && !future && "text-muted-foreground",
          !isToday && future && "text-muted-foreground/40",
        )}
      >
        {n}
      </span>
      {day && day.pending > 0 && <span className="absolute top-2 right-2 size-2 bg-current" aria-hidden />}
      {day?.totals && share === null && (
        <Label className="absolute right-1 bottom-1 text-[10px] text-muted-foreground">
          {(day.totals.energyKcal / 1000).toFixed(1)}k
        </Label>
      )}
    </button>
  );
}

function Swatch({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative flex size-5 shrink-0 flex-col justify-end overflow-hidden bg-tint">
      {children}
    </span>
  );
}

function Legend() {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
      <li className="flex items-center gap-2">
        <Swatch>
          <span className="h-[60%] w-full bg-lime" />
        </Swatch>
        <Label className="text-[11px] text-muted-foreground">kcal of the target</Label>
      </li>
      <li className="flex items-center gap-2">
        <Swatch>
          <span className="h-[30%] w-full bg-foreground" />
          <span className="h-0.5 w-full bg-tint" />
          <span className="h-[70%] w-full bg-lime" />
        </Swatch>
        <Label className="text-[11px] text-muted-foreground">over the target</Label>
      </li>
      <li className="flex items-center gap-2">
        <Swatch>
          <span className="absolute top-1 right-1 size-1.5 bg-foreground" />
        </Swatch>
        <Label className="text-[11px] text-muted-foreground">not analysed yet</Label>
      </li>
      <li className="flex items-center gap-2">
        <Swatch>
          <span className="absolute inset-0 flex items-center justify-center font-bold text-[10px] text-muted-foreground">
            8
          </span>
        </Swatch>
        <Label className="text-[11px] text-muted-foreground">nothing logged</Label>
      </li>
    </ul>
  );
}

/** The month so far, on tint: days tracked, average kcal and protein against the target, weight. */
function Summary({ month }: { month: string }) {
  const s = monthSummary(month);
  const kcalTarget = s.targets?.energyKcal ?? null;
  const proteinTarget = s.targets?.protein ?? null;
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5">
      <div className="flex items-end justify-between">
        <h2 className="display text-[22px]">
          {month === LAST_MONTH ? "This month so far" : monthName(month)}
        </h2>
        <Label className="text-muted-foreground">
          {s.pending > 0 ? `${plural(s.pending, "day")} waiting` : "all analysed"}
        </Label>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        <Stat value={`${s.tracked}`} unit={`/${s.daysSoFar}`} label="tracked" />
        <Stat
          value={s.avgKcal === null ? "—" : formatNumber(s.avgKcal)}
          unit={kcalTarget !== null && s.avgKcalShare !== null ? `${Math.round(s.avgKcalShare * 100)}%` : ""}
          label="avg kcal"
        />
        <Stat
          value={s.avgProtein === null ? "—" : formatNumber(s.avgProtein)}
          unit={proteinTarget !== null ? `/${proteinTarget}` : "g"}
          label="avg prot"
        />
        <Stat
          value={s.weightTo === null ? "—" : formatKg(s.weightTo)}
          unit={
            s.weightFrom !== null && s.weightTo !== null
              ? `${s.weightTo - s.weightFrom > 0 ? "+" : "−"}${formatKg(Math.abs(s.weightTo - s.weightFrom))}`
              : "kg"
          }
          label="weight"
        />
      </div>
    </Band>
  );
}

function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-0.5">
        <span className="display text-[22px]">{value}</span>
        <span className="font-bold text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <Label className="mt-1.5 text-[11px] text-muted-foreground">{label}</Label>
    </div>
  );
}

function MonthStep({
  side,
  label,
  onClick,
  disabled = false,
}: {
  side: "prev" | "next";
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "prev" ? `Previous month: ${label}` : `Next month: ${label}`}
      className={cn(
        "flex h-[76px] items-center gap-2 px-4 font-bold text-lg uppercase tracking-wide outline-none",
        "enabled:active:bg-lime enabled:active:text-lime-foreground focus-visible:underline disabled:text-muted-foreground/50",
        side === "prev" ? "justify-start" : "justify-end",
      )}
    >
      {side === "prev" && <ChevronLeft className="size-6 shrink-0" strokeWidth={2.5} />}
      <span className="truncate">{label}</span>
      {side === "next" && <ChevronRight className="size-6 shrink-0" strokeWidth={2.5} />}
    </button>
  );
}
