import { Link } from "@tanstack/react-router";
import { Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { days, goals, type Meal } from "@/design/mock";
import { Bar, Eyebrow, Rule, Status } from "./ui";

export function Overview() {
  const today = days[0]!;
  return (
    <>
      <header className="flex items-end justify-between px-5 pt-5 pb-3">
        <div>
          <Eyebrow>yamt · Sunday</Eyebrow>
          <h1 className="display mt-1 text-[32px] leading-none">2 November</h1>
        </div>
        <Link to="/design/a/goals" className="-m-2 p-2 text-muted-foreground" aria-label="Goals and weight">
          <Target className="size-5" />
        </Link>
      </header>

      <main className="flex-1 pb-28">
        <section className="px-5 pt-2">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="display text-[44px] leading-none">
                {today.totals.kcal.toLocaleString("en")}
              </span>
              <span className="text-muted-foreground text-sm">of {goals.kcal.toLocaleString("en")} kcal</span>
            </div>
            <span className="text-muted-foreground text-sm">{goals.kcal - today.totals.kcal} left</span>
          </div>
          <div className="mt-3">
            <Bar value={today.totals.kcal} goal={goals.kcal} tone="ink" />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            {(
              [
                ["Protein", today.totals.protein, goals.protein],
                ["Fat", today.totals.fat, goals.fat],
                ["Carbs", today.totals.carbs, goals.carbs],
                ["Fiber", today.totals.fiber, goals.fiber],
              ] as const
            ).map(([label, v, g]) => (
              <div key={label}>
                <Eyebrow>{label}</Eyebrow>
                <div className="mt-1 whitespace-nowrap text-sm">
                  <span className="display text-lg">{v}</span>
                  <span className="text-muted-foreground text-xs"> /{g}</span>
                </div>
                <div className="mt-1.5">
                  <Bar value={v} goal={g} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {days.map((day, i) => (
          <section key={day.date} className="mt-7">
            <div className="flex items-baseline justify-between px-5 pb-2">
              <Eyebrow>
                {day.label} · {day.date}
              </Eyebrow>
              {i > 0 && (
                <span className="text-muted-foreground text-xs">
                  {day.totals.kcal.toLocaleString("en")} / {goals.kcal.toLocaleString("en")} kcal
                </span>
              )}
            </div>
            <Rule />
            {day.meals.map((m) => (
              <MealRow key={m.id} meal={m} />
            ))}
          </section>
        ))}
      </main>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-background/90 px-5 pt-3 pb-6 backdrop-blur">
        <Button asChild size="lg" className="h-14 w-full rounded-sm text-base">
          <Link to="/design/a/log">
            <Plus className="size-5" /> Log meal
          </Link>
        </Button>
      </footer>
    </>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const attention = meal.status === "needs_input";
  return (
    <Link
      to="/design/a/meal"
      className="relative flex min-h-16 items-start gap-4 border-border border-b px-5 py-3 active:bg-muted"
    >
      {attention && <span className="absolute inset-y-2 left-0 w-[3px] bg-(--attention)" />}
      <span className="w-11 shrink-0 pt-0.5 text-muted-foreground text-sm">{meal.time}</span>
      <span className="min-w-0 flex-1">
        <span className="display block text-[17px] leading-tight">{meal.title}</span>
        <span className="mt-1 block">
          <Status
            status={meal.status}
            detail={meal.status === "needs_input" ? "1 question" : meal.captures}
          />
        </span>
      </span>
      <span className="shrink-0 pt-0.5 text-right">
        {meal.kcal !== undefined ? (
          <>
            <span className="display text-lg">{meal.kcal}</span>
            <span className="text-muted-foreground text-xs"> kcal</span>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </span>
    </Link>
  );
}
