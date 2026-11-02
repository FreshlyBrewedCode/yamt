import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Plus, Scale } from "lucide-react";
import { days, goals, type Meal } from "@/design/mock";
import { FatBar, Label, Stamp } from "./ui";

export function Overview() {
  const today = days[0]!;
  const left = goals.kcal - today.totals.kcal;
  return (
    <>
      <header className="flex items-start justify-between px-4 pt-5">
        <div>
          <Label>Sunday 2 Nov</Label>
          <h1 className="display mt-1 text-[40px]">Today</h1>
        </div>
        <Link
          to="/design/b/goals"
          className="brick-flat flex size-12 items-center justify-center"
          aria-label="Goals"
        >
          <Scale className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1 px-4 pb-32">
        <section className="brick mt-4 bg-background p-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="display text-[64px]">{today.totals.kcal.toLocaleString("en")}</div>
              <Label className="mt-2">kcal eaten</Label>
            </div>
            <div className="text-right">
              <div className="display text-[28px]">{left}</div>
              <Label className="mt-1 text-muted-foreground">left of {goals.kcal.toLocaleString("en")}</Label>
            </div>
          </div>
          <FatBar value={today.totals.kcal} goal={goals.kcal} className="mt-4" />
          <div className="mt-4 grid grid-cols-4 gap-2">
            {(
              [
                ["Prot", today.totals.protein, goals.protein],
                ["Fat", today.totals.fat, goals.fat],
                ["Carb", today.totals.carbs, goals.carbs],
                ["Fibre", today.totals.fiber, goals.fiber],
              ] as const
            ).map(([l, v, g]) => (
              <div key={l} className="border-t-[3px] border-foreground pt-2">
                <Label>{l}</Label>
                <div className="display mt-1 text-2xl">{v}</div>
                <div className="font-bold text-muted-foreground text-xs">/{g}g</div>
                <FatBar value={v} goal={g} className="mt-2 h-2" />
              </div>
            ))}
          </div>
        </section>

        {days.map((day, i) => (
          <section key={day.date} className="mt-7">
            <div className="flex items-end justify-between border-foreground border-b-[3px] pb-2">
              <h2 className="display text-[26px]">{day.label}</h2>
              <Label className="text-muted-foreground">
                {i === 0 ? `${day.meals.length} meals` : `${day.totals.kcal.toLocaleString("en")} kcal`}
              </Label>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {day.meals.map((m) => (
                <MealTile key={m.id} meal={m} />
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-linear-to-t from-background from-55% to-transparent px-4 pt-8 pb-6">
        <Link
          to="/design/b/log"
          className="brick flex h-[72px] items-center justify-center gap-3 bg-(--lime) font-bold text-2xl text-foreground uppercase tracking-wide active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <Plus className="size-8" strokeWidth={3} /> Log meal
        </Link>
      </footer>
    </>
  );
}

function MealTile({ meal }: { meal: Meal }) {
  const hot = meal.status === "needs_input";
  return (
    <Link
      to="/design/b/meal"
      className={
        hot
          ? "brick flex min-h-20 gap-3 bg-(--lime) p-3 text-foreground active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          : "brick-flat flex min-h-20 gap-3 bg-background p-3 active:bg-muted"
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{meal.time}</span>
          <Stamp status={meal.status} />
        </div>
        <div className="display mt-2 text-xl leading-[1.05]! tracking-[-0.02em]!">{meal.title}</div>
        <div className="mt-1.5 font-medium text-muted-foreground text-xs">
          {hot ? "1 question for you" : meal.captures}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between">
        {meal.kcal !== undefined ? (
          <div className="text-right">
            <div className="display text-[28px]">{meal.kcal}</div>
            <Label className="text-[10px] text-muted-foreground">kcal</Label>
          </div>
        ) : (
          <div className="display text-[28px] text-muted-foreground">—</div>
        )}
        <ArrowUpRight className="size-5" strokeWidth={2.5} />
      </div>
    </Link>
  );
}
