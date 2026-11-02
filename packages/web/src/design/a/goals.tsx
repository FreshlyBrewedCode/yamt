import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trend } from "@/design/chart";
import { goals, todayWeight, weights } from "@/design/mock";
import { Eyebrow, Rule } from "./ui";

const W = 350;
const H = 140;

export function Goals() {
  const t = trend(weights, W, H, 8);
  return (
    <>
      <header className="px-5 pt-4 pb-3">
        <Link to="/design/a" className="-ml-1 inline-flex items-center gap-0.5 text-muted-foreground text-sm">
          <ChevronLeft className="size-4" /> Today
        </Link>
        <h1 className="display mt-2 text-[32px] leading-none">Goals & weight</h1>
      </header>

      <main className="flex-1 pb-10">
        <section className="mt-2">
          <div className="flex items-baseline justify-between px-5 pb-2">
            <Eyebrow>Daily targets</Eyebrow>
            <span className="text-muted-foreground text-xs">in force since 14 Oct</span>
          </div>
          <Rule />
          {(
            [
              ["Energy", goals.kcal, "kcal"],
              ["Protein", goals.protein, "g"],
              ["Fat", goals.fat, "g"],
              ["Carbs", goals.carbs, "g"],
              ["Fiber", goals.fiber, "g"],
            ] as const
          ).map(([label, value, unit]) => (
            <label
              key={label}
              htmlFor={`a-goal-${label}`}
              className="flex min-h-14 items-center gap-3 border-border border-b px-5"
            >
              <span className="flex-1 text-[15px]">{label}</span>
              <Input
                id={`a-goal-${label}`}
                defaultValue={value}
                inputMode="numeric"
                className="display h-10 w-24 rounded-sm text-right text-lg"
              />
              <span className="w-8 text-muted-foreground text-sm">{unit}</span>
            </label>
          ))}
          <div className="flex items-center justify-between px-5 pt-3">
            <span className="text-muted-foreground text-xs">Takes effect from today</span>
            <Button className="h-11 rounded-sm px-6">Save targets</Button>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between px-5 pb-2">
            <Eyebrow>Weight</Eyebrow>
            <span className="text-muted-foreground text-xs">
              last: {todayWeight.kg} kg · {todayWeight.date}
            </span>
          </div>
          <Rule />
          <div className="flex items-center gap-3 px-5 py-3">
            <Input
              placeholder={String(todayWeight.kg)}
              inputMode="decimal"
              className="display h-12 flex-1 rounded-sm text-2xl"
            />
            <span className="text-muted-foreground text-sm">kg</span>
            <Button className="h-12 rounded-sm px-6">Log</Button>
          </div>
          <Rule />
          <div className="px-5 pt-4">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="display text-[28px] leading-none">{t.lastAvg.toFixed(1)}</span>
                <span className="text-muted-foreground text-sm"> kg · 7-day average</span>
              </div>
              <span className="text-accent text-sm">
                {t.delta > 0 ? "+" : ""}
                {t.delta.toFixed(1)} kg in 5 weeks
              </span>
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="mt-3 h-auto w-full"
              role="img"
              aria-label="Weight trend"
            >
              {t.ticks.map((tk) => (
                <g key={tk.kg}>
                  <line x1={0} x2={W} y1={tk.y} y2={tk.y} stroke="var(--border)" strokeWidth={1} />
                  <text x={W} y={tk.y - 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                    {tk.kg.toFixed(0)}
                  </text>
                </g>
              ))}
              {t.raw.map((p) => (
                <circle key={p.x} cx={p.x} cy={p.y} r={2.2} fill="var(--muted-foreground)" opacity={0.55} />
              ))}
              <path d={t.avgPath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
            </svg>
            <div className="mt-1 flex justify-between text-muted-foreground text-xs">
              <span>29 Sep</span>
              <span>Today</span>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
