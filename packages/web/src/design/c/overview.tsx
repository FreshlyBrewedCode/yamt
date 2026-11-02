import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { days, goals, type Meal } from "@/design/mock";
import { Card, Chip, Ring, SectionTitle, SoftBar, TabBar } from "./ui";

export function Overview() {
  const today = days[0]!;
  return (
    <>
      <header className="px-5 pt-6">
        <p className="font-semibold text-muted-foreground text-sm">Sunday, 2 November</p>
        <h1 className="display mt-0.5 text-[30px]">Good evening</h1>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-32">
        <Card className="flex items-center gap-5 p-5">
          <Ring value={today.totals.kcal} goal={goals.kcal} size={132} stroke={13}>
            <span className="display text-[30px] leading-none">{today.totals.kcal.toLocaleString("en")}</span>
            <span className="mt-1 font-semibold text-muted-foreground text-xs">
              of {goals.kcal.toLocaleString("en")}
            </span>
          </Ring>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {(
              [
                ["Protein", today.totals.protein, goals.protein, "var(--accent)"],
                ["Fat", today.totals.fat, goals.fat, "var(--amber)"],
                ["Carbs", today.totals.carbs, goals.carbs, "var(--blue)"],
                ["Fiber", today.totals.fiber, goals.fiber, "var(--muted-foreground)"],
              ] as const
            ).map(([l, v, g, tone]) => (
              <div key={l}>
                <div className="flex items-baseline justify-between font-bold text-xs">
                  <span>{l}</span>
                  <span>
                    {v}
                    <span className="font-semibold text-muted-foreground"> / {g} g</span>
                  </span>
                </div>
                <div className="mt-1">
                  <SoftBar value={v} goal={g} tone={tone} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {days.map((day, i) => (
          <section key={day.date}>
            <SectionTitle aside={i === 0 ? day.date : `${day.totals.kcal.toLocaleString("en")} kcal`}>
              {day.label}
            </SectionTitle>
            <Card className="divide-y divide-border">
              {day.meals.map((m) => (
                <MealRow key={m.id} meal={m} />
              ))}
            </Card>
          </section>
        ))}
      </main>

      <TabBar active="meals" />
    </>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  return (
    <Link
      to="/design/c/meal"
      className="flex min-h-[68px] items-center gap-3 px-4 py-3 first:rounded-t-[20px] last:rounded-b-[20px] active:bg-muted"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold text-[15px]">{meal.title}</div>
        <div className="mt-1 flex items-center gap-2 font-semibold text-muted-foreground text-xs">
          <span>{meal.time}</span>
          <Chip status={meal.status} />
          {meal.status === "draft" && <span className="truncate">{meal.captures}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {meal.kcal !== undefined ? (
          <>
            <span className="display text-lg">{meal.kcal}</span>
            <span className="font-semibold text-muted-foreground text-xs"> kcal</span>
          </>
        ) : (
          <span className="font-semibold text-muted-foreground text-sm">…</span>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
