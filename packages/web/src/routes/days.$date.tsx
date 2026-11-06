import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { addDays, goalLabel, LocalDate } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Scale, Square } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { groupByDay, MealRow } from "@/components/meal-row";
import { AteItSheet, PlannedNote, PlannedRow } from "@/components/planning";
import { RemovedStrip } from "@/components/remove-meal";
import { BackButton, Band, BottomSlab, iconButtonClass, Label, Strip } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import {
  dateStart,
  dayLabel,
  formatKg,
  formatLongDate,
  formatMonth,
  formatShortDate,
  formatTime,
  localDate,
  plural,
} from "@/lib/format";
import { useOutbox } from "@/lib/outbox";
import { stillPlanned, withPlanned } from "@/lib/planning";
import { useDay, usePlan } from "@/lib/queries";

interface DaySearch {
  /** A meal of the day was just removed: the strip offers Undo. */
  removed?: string;
}

export const Route = createFileRoute("/days/$date")({
  validateSearch: (s: Record<string, unknown>): DaySearch =>
    typeof s.removed === "string" && /^[0-9a-f-]{36}$/i.test(s.removed) ? { removed: s.removed } : {},
  // a date that isn't one goes to today
  beforeLoad: ({ params }) => {
    if (!LocalDate.safeParse(params.date).success) {
      throw redirect({ to: "/days/$date", params: { date: localDate(Date.now()) }, replace: true });
    }
  },
  component: DayView,
});

/**
 * One calendar day: its totals against the goal in force that day (the ink slab, with what's
 * left or over per target and the meals not counted yet), the goal line (to the goals screen),
 * the day's meals (its planned ones still to log after them, #40, with Ate it) and its weight.
 * The bottom slab steps to the day before or after. Right after
 * a meal of the day was removed, a strip at the top offers Undo.
 */
function DayView() {
  const { date } = Route.useParams();
  const { removed } = Route.useSearch();
  const navigate = useNavigate();
  const now = Date.now();
  const today = localDate(now);
  const start = dateStart(date);
  const day = useDay(date);
  const outbox = useOutbox();
  const isToday = date === today;
  const data = day.data?.date === date ? day.data : undefined;
  const plan = usePlan(date, date);
  const planDay = plan.data?.days.find((d) => d.date === date);
  const planned = stillPlanned(planDay);
  const [ate, setAte] = useState<string | null>(null);

  const rows = useMemo(
    () => groupByDay(data?.meals ?? [], outbox.entries).find((d) => d.start === start)?.rows ?? [],
    [data, outbox.entries, start],
  );
  // not analysed yet (or only on this phone): listed, not in the totals
  const waiting = rows.filter((r) => !r.meal?.totals).length;
  const goal = data?.goal ?? null;
  const step = (n: number) =>
    navigate({ to: "/days/$date", params: { date: addDays(date, n) }, replace: true });
  const dropRemoved = useCallback(
    () => void navigate({ to: "/days/$date", params: { date }, search: {}, replace: true }),
    [navigate, date],
  );

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <div className="flex gap-2">
            <Link
              to="/calendar"
              search={{ month: date.slice(0, 7), day: date }}
              className={iconButtonClass}
              aria-label={`${formatMonth(date.slice(0, 7))} in the calendar`}
              data-testid="day-calendar"
            >
              <CalendarDays className="size-6" strokeWidth={2.5} />
            </Link>
            <Link to="/goals" className={iconButtonClass} aria-label="Goals and weight">
              <Scale className="size-6" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
        <Label className="mt-4 text-muted-foreground">{formatLongDate(start)}</Label>
        <h1 className="display mt-1 text-[36px]" data-testid="day-title">
          {dayLabel(start, now)}
        </h1>
      </header>

      <main className="flex-1">
        {removed && <RemovedStrip key={removed} mealId={removed} onDone={dropRemoved} />}
        <TotalsSlab
          totals={data?.totals ?? null}
          label={isToday ? "kcal today" : "kcal eaten"}
          targets={goal?.targets}
          showLeft
          data-testid="day-totals"
          note={[
            waiting > 0 && (
              <>
                <Square className="size-2.5 fill-current" strokeWidth={0} />
                {plural(waiting, "meal")} not counted yet
              </>
            ),
            withPlanned(planDay) && <PlannedNote day={planDay} />,
          ]}
        />

        <Link
          to="/goals"
          className="flex min-h-14 items-center justify-between gap-3 px-5 outline-none active:bg-tint focus-visible:underline"
          data-testid="day-goal"
        >
          <span className="font-bold">
            {!data
              ? " "
              : goal
                ? `Goal since ${formatShortDate(goal.effectiveFrom)}${goalLabel(goal) ? ` · ${goalLabel(goal)}` : ""}`
                : "No targets for this day"}
          </span>
          <Label className="flex items-center gap-1 text-muted-foreground">
            {goal ? "Targets" : "Set targets"} <ArrowRight className="size-4" strokeWidth={2.5} />
          </Label>
        </Link>

        <section aria-label="Meals">
          <Strip
            title="Meals"
            meta={`${plural(rows.length, "meal")}${planned.length ? ` · ${planned.length} planned` : ""}`}
          />
          {rows.length === 0 && planned.length === 0 ? (
            <p className="px-5 py-6 font-medium text-muted-foreground">
              {day.isPending
                ? "Loading…"
                : day.isError
                  ? "Can't reach yamt right now."
                  : "Nothing logged on this day."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <MealRow key={r.id} row={r} />
              ))}
              {planned.map((p) => (
                <PlannedRow key={p.id} planned={p} onAte={() => setAte(p.id)} />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Weight" data-testid="day-weight">
          <Strip
            title="Weight"
            meta={data?.weight.length ? plural(data.weight.length, "entry", "entries") : undefined}
          />
          {data?.weight.length ? (
            <ul className="divide-y divide-border">
              {data.weight.map((w) => (
                <li key={w.id} className="flex min-h-14 items-center justify-between px-5">
                  <span className="font-bold">{formatTime(w.measuredAt)}</span>
                  <span className="display text-[24px]">
                    {formatKg(w.kg)}
                    <span className="ml-1 font-bold text-muted-foreground text-xs">kg</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex min-h-14 items-center justify-between gap-3 px-5">
              <span className="font-medium text-muted-foreground">No weight logged.</span>
              {isToday && (
                <Link to="/goals" className="flex min-h-11 items-center gap-1 font-bold">
                  Log weight <ArrowRight className="size-4" strokeWidth={2.5} />
                </Link>
              )}
            </div>
          )}
        </section>
      </main>

      {/* stepping through days is this screen's action, where the thumb is */}
      <BottomSlab>
        <Band tone="tint" className="grid grid-cols-2 divide-x divide-border">
          <DayStep onClick={() => step(-1)} label={dayLabel(dateStart(addDays(date, -1)), now)} side="prev" />
          <DayStep
            onClick={() => step(1)}
            label={dayLabel(dateStart(addDays(date, 1)), now)}
            side="next"
            disabled={date >= today}
          />
        </Band>
      </BottomSlab>
      <AteItSheet
        planned={planned.find((p) => p.id === ate) ?? null}
        onClose={() => setAte(null)}
        onLogged={({ meal }) => {
          setAte(null);
          void navigate({ to: "/meals/$mealId", params: { mealId: meal.id } });
        }}
      />
    </>
  );
}

function DayStep({
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
      aria-label={side === "prev" ? `Previous day: ${label}` : `Next day: ${label}`}
      className={cn(
        "flex h-[76px] items-center gap-2 px-4 font-bold text-lg uppercase tracking-wide outline-none",
        "enabled:active:bg-lime enabled:active:text-lime-foreground focus-visible:underline disabled:text-muted-foreground/50",
        side === "prev" ? "justify-start" : "justify-end",
      )}
      data-testid={`day-${side}`}
    >
      {side === "prev" && <ChevronLeft className="size-6 shrink-0" strokeWidth={2.5} />}
      <span className="truncate">{label}</span>
      {side === "next" && <ChevronRight className="size-6 shrink-0" strokeWidth={2.5} />}
    </button>
  );
}
