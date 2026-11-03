import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus, Scale } from "lucide-react";
import { days, goals, type Meal } from "@/design/mock";
import { Band, Bar, Label, Status } from "./ui";

export function Overview() {
  const today = days[0]!;
  const left = goals.kcal - today.totals.kcal;
  return (
    <>
      <header className="flex items-end justify-between px-5 pt-5 pb-4">
        <div>
          <Label className="text-muted-foreground">Sunday 2 Nov</Label>
          <h1 className="display mt-1 text-[36px]">Today</h1>
        </div>
        <Link
          to="/design/d/goals"
          className="band-tint flex size-12 items-center justify-center active:opacity-70"
          aria-label="Goals"
        >
          <Scale className="size-6" strokeWidth={2.5} />
        </Link>
      </header>

      <main className="flex-1">
        {/* The one thing: today against the goal, as an ink slab. */}
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="display text-[64px]">{today.totals.kcal.toLocaleString("en")}</div>
              <Label className="mt-2 text-(--ink-muted)">kcal eaten</Label>
            </div>
            <div className="pb-1 text-right">
              <div className="display text-[28px] text-(--lime)">{left.toLocaleString("en")}</div>
              <Label className="mt-1 text-(--ink-muted)">left of {goals.kcal.toLocaleString("en")}</Label>
            </div>
          </div>
          <Bar
            value={today.totals.kcal}
            goal={goals.kcal}
            className="mt-4 h-3"
            track="bg-(--ink-line)"
            fill="bg-(--lime)"
          />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {(
              [
                ["Prot", today.totals.protein, goals.protein],
                ["Fat", today.totals.fat, goals.fat],
                ["Carb", today.totals.carbs, goals.carbs],
                ["Fibre", today.totals.fiber, goals.fiber],
              ] as const
            ).map(([l, v, g]) => (
              <div key={l}>
                <div className="flex items-baseline gap-1">
                  <span className="display text-[22px]">{v}</span>
                  <span className="font-bold text-(--ink-muted) text-xs">/{g}</span>
                </div>
                <Bar value={v} goal={g} className="mt-1.5 h-1.5" track="bg-(--ink-line)" fill="bg-(--lime)" />
                <Label className="mt-1.5 text-(--ink-muted)">{l}</Label>
              </div>
            ))}
          </div>
        </Band>

        {days.map((day, i) => (
          <section key={day.date}>
            <div className="band-tint flex items-end justify-between px-5 pt-4 pb-2">
              <h2 className="display text-[22px]">{day.label}</h2>
              <Label className="text-muted-foreground">
                {i === 0 ? `${day.meals.length} meals` : `${day.totals.kcal.toLocaleString("en")} kcal`}
              </Label>
            </div>
            <ul className="divide-y divide-border">
              {day.meals.map((m) => (
                <MealRow key={m.id} meal={m} />
              ))}
            </ul>
          </section>
        ))}
      </main>

      {/* Log meal is part of the layout: a lime slab at the bottom, never floating over the list. */}
      <footer className="sticky bottom-0">
        <Link
          to="/design/d/log"
          className="band-lime flex h-[76px] items-center justify-center gap-3 font-bold text-2xl uppercase tracking-wide active:opacity-80"
        >
          <Plus className="size-8" strokeWidth={3} /> Log meal
        </Link>
      </footer>
    </>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const hot = meal.status === "needs_input";
  const failed = meal.status === "failed";
  return (
    <li className={hot ? "band-lime" : failed ? "band-orange" : ""}>
      <Link
        to="/design/d/meal"
        className={
          hot || failed
            ? "flex min-h-[84px] items-stretch gap-4 px-5 py-3 active:opacity-80"
            : "flex min-h-[84px] items-stretch gap-4 px-5 py-3 active:bg-(--tint)"
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold">{meal.time}</span>
            <span className={hot || failed ? "opacity-60" : "text-muted-foreground"}>·</span>
            <Status status={meal.status} />
          </div>
          <div className="display mt-1.5 text-[19px] leading-[1.05]! tracking-[-0.02em]!">{meal.title}</div>
          <div
            className={
              hot
                ? "mt-1.5 font-bold text-sm"
                : failed
                  ? "mt-1.5 font-bold text-sm"
                  : "mt-1.5 font-medium text-muted-foreground text-xs"
            }
          >
            {hot
              ? "1 question for you"
              : failed
                ? "Audio file couldn't be read. Tap to retry."
                : meal.captures}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between">
          {meal.kcal !== undefined ? (
            <div className="text-right">
              <div className="display text-[26px]">{meal.kcal}</div>
              <Label
                className={hot ? "text-[10px] text-(--lime-muted)" : "text-[10px] text-muted-foreground"}
              >
                {hot ? "prelim." : "kcal"}
              </Label>
            </div>
          ) : (
            <div className={failed ? "display text-[26px]" : "display text-[26px] text-muted-foreground/40"}>
              —
            </div>
          )}
          {(hot || failed) && <ArrowRight className="size-5" strokeWidth={2.5} />}
        </div>
      </Link>
    </li>
  );
}
