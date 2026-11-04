// Variant B · Bars: the selected day's totals slab sits on top (the overview's slab, for any
// day), then the month as a grid of tiles with five small bars each (kcal, protein, fat, carbs,
// fibre against the day's targets), the month's numbers as plain rows, and "Open day" as the
// bottom slab. Month stepping lives in the month strip.
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BackButton, BottomSlab, Label, SlabButton } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import { dateStart, dayLabel, formatKg, formatNumber, formatShortDate, plural } from "@/lib/format";
import {
  addMonths,
  asTotals,
  dayOf,
  FIRST_MONTH,
  goalFor,
  inMonth,
  LAST_MONTH,
  type MockDay,
  monthName,
  monthSummary,
  monthWeeks,
  NOW,
  shares,
  TODAY,
  WEEKDAYS,
  yearOf,
} from "../mock";

const BAR_NAMES = ["kcal", "Prot", "Fat", "Carb", "Fibre"] as const;

export function CalendarB({
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
  const selected = dayOf(day);
  const goal = goalFor(day);
  const s = monthSummary(month);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const label = dayLabel(dateStart(day), NOW);

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <BackButton />
        <Label className="mt-4 text-muted-foreground">
          {formatShortDate(day, NOW)}
          {goal ? ` · goal since ${formatShortDate(goal.effectiveFrom, NOW)}` : " · no targets"}
        </Label>
        <h1 className="display mt-1 text-[36px]">{label}</h1>
      </header>

      <main className="flex-1">
        {/* the one thing: the selected day's numbers, the same slab as the overview's */}
        <TotalsSlab
          totals={selected?.totals ? asTotals(selected.totals) : null}
          label={day === TODAY ? "kcal today" : "kcal eaten"}
          targets={goal?.targets}
          showLeft
          note={
            selected?.pending ? (
              <>
                <span className="size-2.5 bg-current" />
                {plural(selected.pending, "meal")} not counted yet
              </>
            ) : selected?.meals ? undefined : (
              "Nothing logged on this day"
            )
          }
        />

        {/* the month strip carries the stepping */}
        <div className="flex items-center justify-between bg-tint px-5 py-3">
          <button
            type="button"
            onClick={() => onMonth(prev)}
            disabled={prev < FIRST_MONTH}
            aria-label="Previous month"
            className="flex size-11 items-center justify-center bg-background outline-none active:bg-lime disabled:text-muted-foreground/40 disabled:active:bg-background"
          >
            <ChevronLeft className="size-6" strokeWidth={2.5} />
          </button>
          <div className="text-center">
            <h2 className="display text-[22px]">{monthName(month)}</h2>
            <Label className="mt-1 text-muted-foreground">
              {yearOf(month)} · {s.tracked} of {s.daysSoFar} days
            </Label>
          </div>
          <button
            type="button"
            onClick={() => onMonth(next)}
            disabled={next > LAST_MONTH}
            aria-label="Next month"
            className="flex size-11 items-center justify-center bg-background outline-none active:bg-lime disabled:text-muted-foreground/40 disabled:active:bg-background"
          >
            <ChevronRight className="size-6" strokeWidth={2.5} />
          </button>
        </div>

        <section className="px-5 pt-3 pb-4" aria-label={`${monthName(month)} ${yearOf(month)}`}>
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

        {/* the month's numbers as plain rows */}
        <ul className="divide-y divide-border border-border border-t">
          <Row label="Days tracked" value={`${s.tracked}`} unit={`of ${s.daysSoFar}`} />
          <Row
            label="Average kcal"
            value={s.avgKcal === null ? "—" : formatNumber(s.avgKcal)}
            unit={s.avgKcalShare !== null ? `${Math.round(s.avgKcalShare * 100)} % of target` : "no target"}
          />
          <Row
            label="Average protein"
            value={s.avgProtein === null ? "—" : formatNumber(s.avgProtein)}
            unit={s.targets?.protein ? `of ${s.targets.protein} g` : "g"}
          />
          <Row
            label="Weight · 7-day avg"
            value={s.weightTo === null ? "—" : formatKg(s.weightTo)}
            unit={s.weightFrom !== null && s.weightTo !== null ? `kg · from ${formatKg(s.weightFrom)}` : "kg"}
          />
          {s.pending > 0 && (
            <li className="flex min-h-14 items-center gap-2 px-5">
              <span className="size-2.5 bg-current" />
              <span className="font-medium text-muted-foreground">
                {plural(s.pending, "day")} with meals not analysed yet
              </span>
            </li>
          )}
        </ul>
      </main>

      <BottomSlab>
        <SlabButton tone="tint" onClick={() => navigate({ to: "/days/$date", params: { date: day } })}>
          Open {label} <ArrowRight className="size-7" strokeWidth={2.5} />
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/**
 * One day: five bars for kcal, protein, fat, carbs and fibre against their targets. A bar fills
 * lime to its share of the target; past it the bar rescales (the target where the lime ends, a
 * 2 px gap, the excess in the foreground). A small square marks meals not analysed yet; a day
 * with numbers but no target shows its kcal instead of bars.
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
  const isToday = date === TODAY;
  const future = date > TODAY;
  const sh = shares(day);
  const hasBars = sh.some((s) => s !== null);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={future}
      aria-pressed={selected}
      aria-label={`${formatShortDate(date, NOW)}${sh[0] != null ? `, ${Math.round(sh[0] * 100)} % of the kcal target` : day?.meals ? ", not analysed yet" : ", nothing logged"}`}
      className={cn(
        "relative flex h-[68px] flex-col items-start justify-between p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset",
        selected ? "bg-ink text-ink-foreground" : "bg-tint",
      )}
    >
      <span
        className={cn(
          "flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
          isToday && (selected ? "bg-ink-foreground text-ink" : "bg-foreground text-background"),
          !isToday && !day?.meals && !future && "text-muted-foreground",
          !isToday && future && "text-muted-foreground/40",
        )}
      >
        {Number(date.slice(8))}
      </span>
      {day && day.pending > 0 && <span className="absolute top-2 right-2 size-2 bg-current" aria-hidden />}
      {hasBars ? (
        <span className="flex h-7 w-full items-end gap-[3px]" aria-hidden>
          {sh.map((s, i) => (
            <Bar key={BAR_NAMES[i]} share={s} selected={selected} />
          ))}
        </span>
      ) : day?.totals ? (
        <Label className="text-[10px] text-muted-foreground">
          {(day.totals.energyKcal / 1000).toFixed(1)}k
        </Label>
      ) : (
        <span className="h-7" />
      )}
    </button>
  );
}

function Bar({ share, selected }: { share: number | null; selected: boolean }) {
  if (share === null) return <span className="h-full flex-1" />;
  const scale = Math.max(share, 1);
  const lime = Math.min(share, 1) / scale;
  const over = share > 1 ? (share - 1) / scale : 0;
  return (
    <span className={cn("flex h-full flex-1 flex-col justify-end", selected ? "bg-ink-line" : "bg-border")}>
      {over > 0 && (
        <span
          className={cn("w-full", selected ? "bg-ink-foreground" : "bg-foreground")}
          style={{ height: `${over * 100}%` }}
        />
      )}
      {over > 0 && <span className={cn("h-0.5 w-full shrink-0", selected ? "bg-ink" : "bg-tint")} />}
      <span className="w-full bg-lime" style={{ height: `${lime * 100}%` }} />
    </span>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex items-center gap-4">
      <span className="flex h-7 w-10 items-end gap-[3px] bg-tint p-1" aria-hidden>
        {[0.9, 0.7, 1.3, 0.5, 0.4].map((s, i) => (
          <Bar key={BAR_NAMES[i]} share={s} selected={false} />
        ))}
      </span>
      <Label className="text-[11px] text-muted-foreground">
        {BAR_NAMES.join(" · ")} of the day's targets · ■ over · <span className="text-foreground">▪</span> not
        analysed yet
      </Label>
    </div>
  );
}

function Row({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <li className="flex min-h-16 items-center justify-between gap-3 px-5">
      <span className="font-bold">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="display text-[26px]">{value}</span>
        <span className="font-bold text-muted-foreground text-xs">{unit}</span>
      </span>
    </li>
  );
}
