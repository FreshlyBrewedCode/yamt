import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addDays, type PlanDay, type PlanResponse, rangeWords } from "@yamt/shared";
import { cn } from "cn";
import { Check } from "lucide-react";
import { useState } from "react";
import { Caps, fill } from "@/components/calendar";
import { AteItSheet, PlannedRow } from "@/components/planning";
import { BackButton, Band, BottomSlab, Label, SafeBottom, SlabButton, Strip } from "@/components/slab";
import { dateStart, dayLabel, formatNumber, formatShortDate, formatWeekday, localDate } from "@/lib/format";
import { canEat, dayMeta, PLAN_DAYS, readDay, SLOT_NAME } from "@/lib/planning";
import { usePlan } from "@/lib/queries";

export const Route = createFileRoute("/plan/days")({ component: PlanView });

/**
 * The plan (#40, G's "Next days"): today and the next six days as squares on the ink slab, read
 * like the calendar once a day is mostly known ("rest open" before), then each day's planned meals
 * (a tap opens the recipe; today's offer Ate it). The bottom slab is lime **Ate it** while today
 * has a planned meal still to log; otherwise there is none.
 */
function PlanView() {
  const navigate = useNavigate();
  const now = Date.now();
  const today = localDate(now);
  const plan = usePlan(today, addDays(today, PLAN_DAYS - 1));
  const [ate, setAte] = useState<string | null>(null);
  const days = plan.data?.days ?? [];
  const due = days.flatMap((d) => d.plannedMeals).filter((p) => canEat(p, today));
  const ateMeal = days.flatMap((d) => d.plannedMeals).find((p) => p.id === ate) ?? null;

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton />
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Plan</Label>
          <h1 className="display mt-1 text-[36px]">Next days</h1>
        </div>
      </header>

      <main className="flex-1">
        <DaySquares data={plan.data} today={today} />

        {plan.isPending && <p className="px-5 py-6 font-medium text-muted-foreground">Loading…</p>}
        {plan.isError && (
          <p className="px-5 py-6 font-medium text-muted-foreground">
            Can't reach yamt right now: the plan needs it.
          </p>
        )}

        {days.map((d) => (
          <section
            key={d.date}
            id={`day-${d.date}`}
            aria-label={dayLabel(dateStart(d.date), now)}
            data-testid="plan-day"
          >
            <Strip title={dayLabel(dateStart(d.date), now)} meta={dayMeta(d) || formatShortDate(d.date)} />
            {d.plannedMeals.length === 0 ? (
              <p className="flex min-h-[68px] items-center px-5 font-medium text-muted-foreground">
                Nothing planned
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {d.plannedMeals.map((p) => (
                  <PlannedRow
                    key={p.id}
                    planned={p}
                    loggedKcal={d.meals.find((m) => m.plannedMealId === p.id)?.totals?.nutrients.energyKcal}
                    onAte={canEat(p, today) ? () => setAte(p.id) : undefined}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>

      {due[0] ? (
        <BottomSlab>
          <SlabButton onClick={() => setAte(due[0]!.id)} data-testid="plan-ate-it">
            <Check className="size-8" strokeWidth={3} /> Ate it · {SLOT_NAME[due[0].slot]}
          </SlabButton>
        </BottomSlab>
      ) : (
        <SafeBottom />
      )}

      <AteItSheet
        planned={ateMeal}
        onClose={() => setAte(null)}
        onLogged={({ meal }) => {
          setAte(null);
          void navigate({ to: "/meals/$mealId", params: { mealId: meal.id } });
        }}
      />
    </>
  );
}

/**
 * The days as squares on the ink slab (C's plan view): the projected kcal, read with the
 * calendar's fills and caps once the day is mostly known, else "rest open"; a tap scrolls to the
 * day. The line under them says what the squares are read against.
 */
function DaySquares({ data, today }: { data: PlanResponse | undefined; today: string }) {
  const days = data?.days ?? [];
  const goal = days[0]?.goal ?? null;
  return (
    <Band tone="ink" className="px-3 pt-4 pb-4" data-testid="plan-squares">
      <div className="grid grid-cols-4 gap-1">
        {days.map((d) => (
          <DaySquare key={d.date} day={d} today={today} />
        ))}
      </div>
      <Label className="mt-3 px-2 text-ink-muted normal-case tracking-normal">
        {!data
          ? " "
          : goal?.targets.energyKcal != null
            ? `Read against ${goal.label} once a day is mostly known (breakfast, lunch and dinner eaten or planned): ${rangeWords(goal.kind ?? "maintain")}.`
            : "No kcal target today: the squares show the planned kcal only."}
      </Label>
    </Band>
  );
}

function DaySquare({ day, today }: { day: PlanDay; today: string }) {
  const r = readDay(day);
  const look =
    r.look === "plan" && r.c.band !== "none" ? fill[r.c.band] : r.look === "empty" ? fill.empty : fill.kcal;
  return (
    <button
      type="button"
      onClick={() => document.getElementById(`day-${day.date}`)?.scrollIntoView({ behavior: "smooth" })}
      className={cn(
        "relative flex h-[88px] min-w-0 flex-col justify-between overflow-hidden p-2 text-left outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-lime focus-visible:ring-inset",
        look,
      )}
      aria-label={`${dayLabel(dateStart(day.date))}: ${r.kcal === null ? "" : `${formatNumber(r.kcal)} kcal, `}${r.words}`}
      data-testid="plan-square"
      data-date={day.date}
      data-look={r.look}
      data-band={r.c.band}
    >
      <Caps c={r.c} inset={false} />
      <span className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex size-[22px] items-center justify-center font-bold text-[13px] leading-none",
            day.date === today && "bg-ink-foreground text-ink",
          )}
        >
          {Number(day.date.slice(8))}
        </span>
        <Label className="text-[11px] opacity-70">{formatWeekday(day.date)}</Label>
      </span>
      <span className="min-w-0">
        <span className="display block text-[20px]">{r.kcal === null ? "—" : formatNumber(r.kcal)}</span>
        <Label className="mt-0.5 block text-[10px] leading-tight opacity-70">{r.words}</Label>
      </span>
    </button>
  );
}
