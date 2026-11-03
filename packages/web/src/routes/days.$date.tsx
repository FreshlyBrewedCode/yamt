import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { addDays, LocalDate } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, ChevronLeft, ChevronRight, Scale, Square } from "lucide-react";
import { useMemo } from "react";
import { groupByDay, MealRow } from "@/components/meal-row";
import { BackButton, Band, BottomSlab, Label, Strip } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import {
  dateStart,
  dayLabel,
  formatKg,
  formatLongDate,
  formatShortDate,
  formatTime,
  localDate,
  plural,
} from "@/lib/format";
import { useOutbox } from "@/lib/outbox";
import { useDay } from "@/lib/queries";

export const Route = createFileRoute("/days/$date")({
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
 * the day's meals and its weight. The bottom slab steps to the day before or after.
 */
function DayView() {
  const { date } = Route.useParams();
  const navigate = useNavigate();
  const now = Date.now();
  const today = localDate(now);
  const start = dateStart(date);
  const day = useDay(date);
  const outbox = useOutbox();
  const isToday = date === today;
  const data = day.data?.date === date ? day.data : undefined;

  const rows = useMemo(
    () => groupByDay(data?.meals ?? [], outbox.entries).find((d) => d.start === start)?.rows ?? [],
    [data, outbox.entries, start],
  );
  // not analysed yet (or only on this phone): listed, not in the totals
  const waiting = rows.filter((r) => !r.meal?.totals).length;
  const goal = data?.goal ?? null;
  const step = (n: number) =>
    navigate({ to: "/days/$date", params: { date: addDays(date, n) }, replace: true });

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
        <Label className="mt-4 text-muted-foreground">{formatLongDate(start)}</Label>
        <h1 className="display mt-1 text-[36px]" data-testid="day-title">
          {dayLabel(start, now)}
        </h1>
      </header>

      <main className="flex-1">
        <TotalsSlab
          totals={data?.totals ?? null}
          label={isToday ? "kcal today" : "kcal eaten"}
          targets={goal?.targets}
          showLeft
          data-testid="day-totals"
          note={
            waiting > 0 ? (
              <>
                <Square className="size-2.5 fill-current" strokeWidth={0} />
                {plural(waiting, "meal")} not counted yet
              </>
            ) : undefined
          }
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
                ? `Goal since ${formatShortDate(goal.effectiveFrom)}${goal.note ? ` · ${goal.note}` : ""}`
                : "No targets for this day"}
          </span>
          <Label className="flex items-center gap-1 text-muted-foreground">
            {goal ? "Targets" : "Set targets"} <ArrowRight className="size-4" strokeWidth={2.5} />
          </Label>
        </Link>

        <section aria-label="Meals">
          <Strip title="Meals" meta={plural(rows.length, "meal")} />
          {rows.length === 0 ? (
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
