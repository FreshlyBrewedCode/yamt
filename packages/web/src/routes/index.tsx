import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type DayTotals, goalInForce } from "@yamt/shared";
import { CalendarDays, ChevronRight, CloudOff, Scale, Settings, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { groupByDay, MealRow, type MealRowData } from "@/components/meal-row";
import { AteItSheet, PlannedNote, PlannedRow, SplitSlab } from "@/components/planning";
import { iconButtonClass, Label, Strip } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import { dayLabel, formatLongDate, formatNumber, localDate, plural, startOfDay } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { useOutbox } from "@/lib/outbox";
import { stillPlanned, withPlanned } from "@/lib/planning";
import { useGoals, useMeals, usePlan } from "@/lib/queries";

export const Route = createFileRoute("/")({ component: Overview });

/** How far back the overview reaches (days including today); older days through the day view. */
const DAYS = 14;

/**
 * Home: today's totals against today's goal (a tap opens the day view), then the last two weeks'
 * meals by day (each day header opens that day, with its kcal against its own goal); today's
 * planned meals (#40) follow its eaten ones as quiet rows with Ate it, and the totals say what the
 * day comes to with them. The bottom slab is Log | Plan. The header's calendar opens the month
 * (#33), the scale goals and weight, the cog the settings.
 */
function Overview() {
  const navigate = useNavigate();
  const now = Date.now();
  const today = startOfDay(now);
  const from = startOfDay(now, -(DAYS - 1));
  const to = startOfDay(now, 1);
  const meals = useMeals(from, to);
  const goals = useGoals();
  const outbox = useOutbox();
  const todayDate = localDate(now);
  const plan = usePlan(todayDate, todayDate);
  const planToday = plan.data?.days.find((d) => d.date === todayDate);
  const planned = stillPlanned(planToday);
  const [ate, setAte] = useState<string | null>(null);

  const days = useMemo(() => {
    const list = groupByDay(meals.data?.meals ?? [], outbox.entries);
    // today always comes first, even before anything is logged
    return list[0]?.start === today ? list : [{ start: today, rows: [] as MealRowData[] }, ...list];
  }, [meals.data, outbox.entries, today]);
  const totals = new Map<string, DayTotals>((meals.data?.days ?? []).map((d) => [d.date, d]));
  const todayTotals = totals.get(todayDate);
  const todayRows = days.find((d) => d.start === today)?.rows ?? [];
  const waiting = todayRows.filter((r) => !r.meal?.totals).length;
  const goalOn = (date: string) => (goals.data ? goalInForce(goals.data.goals, date) : null);
  const olderDate = localDate(startOfDay(now, -DAYS));

  return (
    <>
      <header className="flex items-end justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <Label className="text-muted-foreground">{formatLongDate(now)}</Label>
          <h1 className="display mt-1 text-[36px]">Today</h1>
        </div>
        <div className="flex gap-2">
          {(!outbox.online || meals.isError) && (
            <Label className="flex h-12 items-center gap-2 bg-tint px-3 text-muted-foreground" role="status">
              <CloudOff className="size-4" strokeWidth={2.5} /> Offline
            </Label>
          )}
          <Link to="/calendar" className={iconButtonClass} aria-label="Calendar">
            <CalendarDays className="size-6" strokeWidth={2.5} />
          </Link>
          <Link to="/goals" className={iconButtonClass} aria-label="Goals and weight">
            <Scale className="size-6" strokeWidth={2.5} />
          </Link>
          <Link to="/settings" className={iconButtonClass} aria-label="Settings">
            <Settings className="size-6" strokeWidth={2.5} />
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* The one thing on this screen: today's totals against today's goal; a tap opens the day. */}
        <Link
          to="/days/$date"
          params={{ date: todayDate }}
          className="block outline-none focus-visible:ring-4 focus-visible:ring-lime focus-visible:ring-inset"
          aria-label="Today in detail"
        >
          <TotalsSlab
            totals={todayTotals?.totals ?? null}
            label="kcal today"
            targets={goalOn(todayDate)?.targets}
            data-testid="today-totals"
            note={[
              waiting > 0 && (
                <>
                  <Square className="size-2.5 fill-current" strokeWidth={0} />
                  {plural(waiting, "meal")} not counted yet
                </>
              ),
              withPlanned(planToday) && <PlannedNote day={planToday} />,
            ]}
          />
        </Link>

        {meals.isError && !meals.data && (
          <p className="px-5 py-6 font-medium text-muted-foreground">
            Can't reach yamt right now. Meals you log are kept on this phone and sent when it's back.
          </p>
        )}

        {days.map((day) => {
          const date = localDate(day.start);
          const kcal = totals.get(date)?.totals.nutrients.energyKcal ?? 0;
          const target = goalOn(date)?.targets.energyKcal ?? null;
          return (
            <section key={day.start} aria-label={dayLabel(day.start, now)}>
              <Link
                to="/days/$date"
                params={{ date }}
                className="block outline-none active:opacity-70 focus-visible:underline"
                data-testid="day-header"
              >
                <Strip
                  title={dayLabel(day.start, now)}
                  meta={
                    <span className="flex items-center gap-1">
                      {day.start === today
                        ? `${plural(day.rows.length, "meal")}${planned.length ? ` · ${planned.length} planned` : ""}`
                        : target !== null
                          ? `${formatNumber(kcal)} / ${formatNumber(target)} kcal`
                          : `${formatNumber(kcal)} kcal`}
                      <ChevronRight className="-mr-1 size-4" strokeWidth={2.5} />
                    </span>
                  }
                />
              </Link>
              {day.rows.length === 0 && (day.start !== today || planned.length === 0) ? (
                <p className="px-5 py-6 font-medium text-muted-foreground">
                  {meals.isPending ? "Loading…" : "Nothing logged yet today."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {day.rows.map((r) => (
                    <MealRow key={r.id} row={r} />
                  ))}
                  {/* what is still planned for today, after what was eaten */}
                  {day.start === today &&
                    planned.map((p) => <PlannedRow key={p.id} planned={p} onAte={() => setAte(p.id)} />)}
                </ul>
              )}
            </section>
          );
        })}

        {/* older meals: the day view steps back as far as there is anything */}
        <Link
          to="/days/$date"
          params={{ date: olderDate }}
          className="flex min-h-14 items-center justify-between bg-tint px-5 font-bold outline-none active:opacity-70 focus-visible:underline"
          data-testid="older-days"
        >
          Earlier days
          <Label className="flex items-center gap-1 text-muted-foreground">
            {dayLabel(startOfDay(now, -DAYS), now)} <ChevronRight className="size-4" strokeWidth={2.5} />
          </Label>
        </Link>
      </main>

      {/* Log | Plan is part of the layout: a slab at the bottom, never floating over the list. Until the
          planning screens exist (#36), Plan opens the plan. */}
      <SplitSlab
        onLog={() => navigate({ to: "/meals/$mealId", params: { mealId: uuidv7() }, search: { new: true } })}
        onPlan={() => navigate({ to: "/plan/days" })}
      />
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
