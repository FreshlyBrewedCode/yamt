import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { trend } from "@/design/chart";
import { goals, todayWeight, weights } from "@/design/mock";
import { BigButton, Label } from "./ui";

const W = 340;
const H = 150;

export function Goals() {
  const t = trend(weights, W, H, 10);
  return (
    <>
      <header className="px-4 pt-5">
        <Link
          to="/design/b"
          className="brick-flat flex size-12 items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="size-6" strokeWidth={2.5} />
        </Link>
        <h1 className="display mt-4 text-[40px]">Goals</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        <section className="brick mt-5 bg-background">
          <div className="flex items-end justify-between border-foreground border-b-[3px] p-3">
            <Label>Daily targets</Label>
            <Label className="text-muted-foreground">since 14 Oct</Label>
          </div>
          <div className="divide-y-[3px] divide-foreground">
            {(
              [
                ["Energy", goals.kcal, "kcal"],
                ["Protein", goals.protein, "g"],
                ["Fat", goals.fat, "g"],
                ["Carbs", goals.carbs, "g"],
                ["Fibre", goals.fiber, "g"],
              ] as const
            ).map(([label, value, unit]) => (
              <label key={label} htmlFor={`b-goal-${label}`} className="flex h-16 items-center gap-3 pl-3">
                <span className="flex-1 font-bold uppercase tracking-wide">{label}</span>
                <input
                  id={`b-goal-${label}`}
                  defaultValue={value}
                  inputMode="numeric"
                  className="display h-full w-28 border-foreground border-l-[3px] bg-transparent px-3 text-right text-[28px] outline-none focus:bg-(--lime)/40"
                />
                <span className="w-12 pr-3 font-bold text-muted-foreground text-xs uppercase">{unit}</span>
              </label>
            ))}
          </div>
          <BigButton tone="ink" className="h-14 border-foreground border-t-[3px] text-base">
            Save · from today
          </BigButton>
        </section>

        <section className="brick mt-6 bg-background">
          <div className="flex items-end justify-between border-foreground border-b-[3px] p-3">
            <Label>Weight</Label>
            <Label className="text-muted-foreground">
              last {todayWeight.kg} kg · {todayWeight.date}
            </Label>
          </div>
          <div className="flex h-20 items-stretch">
            <input
              placeholder={String(todayWeight.kg)}
              inputMode="decimal"
              className="display min-w-0 flex-1 bg-transparent px-3 text-[40px] outline-none placeholder:text-muted-foreground/50 focus:bg-(--lime)/40"
            />
            <span className="flex items-center pr-3 font-bold text-muted-foreground uppercase">kg</span>
            <button
              type="button"
              className="w-28 border-foreground border-l-[3px] bg-(--lime) font-bold text-xl uppercase active:bg-foreground active:text-background"
            >
              Log
            </button>
          </div>
          <div className="border-foreground border-t-[3px] p-3">
            <div className="flex items-end justify-between">
              <div>
                <div className="display text-[40px]">{t.lastAvg.toFixed(1)}</div>
                <Label className="mt-1 text-muted-foreground">kg · 7-day average</Label>
              </div>
              <div className="brick-flat bg-(--lime) px-2 py-1 font-bold">
                {t.delta > 0 ? "+" : ""}
                {t.delta.toFixed(1)} kg / 5 wk
              </div>
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="mt-3 h-auto w-full"
              role="img"
              aria-label="Weight trend"
            >
              {t.ticks.map((tk) => (
                <g key={tk.kg}>
                  <line
                    x1={0}
                    x2={W}
                    y1={tk.y}
                    y2={tk.y}
                    stroke="var(--foreground)"
                    strokeWidth={1.5}
                    strokeDasharray="3 5"
                    opacity={0.35}
                  />
                  <text x={0} y={tk.y - 4} fontSize={11} fontWeight={700} fill="var(--muted-foreground)">
                    {tk.kg.toFixed(0)}
                  </text>
                </g>
              ))}
              {t.raw.map((p) => (
                <rect
                  key={p.x}
                  x={p.x - 2.5}
                  y={p.y - 2.5}
                  width={5}
                  height={5}
                  fill="var(--foreground)"
                  opacity={0.4}
                />
              ))}
              <path
                d={t.avgPath}
                fill="none"
                stroke="var(--foreground)"
                strokeWidth={4}
                strokeLinejoin="round"
              />
              <path d={t.avgPath} fill="none" stroke="var(--lime)" strokeWidth={2} strokeLinejoin="round" />
            </svg>
            <div className="mt-1 flex justify-between">
              <Label className="text-muted-foreground">29 Sep</Label>
              <Label className="text-muted-foreground">Today</Label>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
