import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { trend } from "@/design/chart";
import { goals, todayWeight, weights } from "@/design/mock";
import { Band, BlockButton, Label, Strip } from "./ui";

const W = 350;
const H = 150;

export function Goals() {
  const t = trend(weights, W, H, 10);
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <Link
          to="/design/d"
          className="band-tint -ml-1 flex size-12 items-center justify-center active:opacity-70"
          aria-label="Back"
        >
          <ArrowLeft className="size-6" strokeWidth={2.5} />
        </Link>
        <h1 className="display mt-4 text-[36px]">Goals</h1>
      </header>

      <main className="flex-1">
        {/* Today's weight is the daily action here: a lime slab with one big field. */}
        <Band tone="lime" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between">
            <Label className="text-(--lime-muted)">Weight today</Label>
            <Label className="text-(--lime-muted)">
              last {todayWeight.kg} kg · {todayWeight.date}
            </Label>
          </div>
          <div className="mt-3 flex h-[72px] items-stretch gap-3">
            <label className="flex min-w-0 flex-1 items-center bg-background pr-3 text-foreground">
              <input
                placeholder={String(todayWeight.kg)}
                inputMode="decimal"
                aria-label="Weight in kg"
                className="display h-full min-w-0 flex-1 bg-transparent px-3 text-[40px] outline-none placeholder:text-muted-foreground/40"
              />
              <span className="font-bold text-muted-foreground uppercase">kg</span>
            </label>
            <BlockButton tone="ink" className="h-full w-28 text-xl">
              Log
            </BlockButton>
          </div>
        </Band>

        <Band tone="tint" className="px-5 pt-4 pb-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="display text-[40px]">{t.lastAvg.toFixed(1)}</div>
              <Label className="mt-1 text-muted-foreground">kg · 7-day average</Label>
            </div>
            <div className="band-ink px-2.5 py-1.5 font-bold">
              {t.delta > 0 ? "+" : ""}
              {t.delta.toFixed(1)} kg / 5 wk
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label="Weight trend">
            {t.ticks.map((tk) => (
              <g key={tk.kg}>
                <line
                  x1={0}
                  x2={W}
                  y1={tk.y}
                  y2={tk.y}
                  stroke="var(--foreground)"
                  strokeWidth={1}
                  strokeDasharray="2 5"
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
                x={p.x - 2}
                y={p.y - 2}
                width={4}
                height={4}
                fill="var(--foreground)"
                opacity={0.35}
              />
            ))}
            <path
              d={t.avgPath}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={5}
              strokeLinejoin="round"
            />
            <path d={t.avgPath} fill="none" stroke="var(--lime)" strokeWidth={2.5} strokeLinejoin="round" />
          </svg>
          <div className="mt-1 flex justify-between">
            <Label className="text-muted-foreground">29 Sep</Label>
            <Label className="text-muted-foreground">Today</Label>
          </div>
        </Band>

        <Strip title="Daily targets" meta="since 14 Oct" className="bg-background!" />
        <div className="divide-y divide-border border-border border-t">
          {(
            [
              ["Energy", goals.kcal, "kcal"],
              ["Protein", goals.protein, "g"],
              ["Fat", goals.fat, "g"],
              ["Carbs", goals.carbs, "g"],
              ["Fibre", goals.fiber, "g"],
            ] as const
          ).map(([label, value, unit]) => (
            <label key={label} htmlFor={`d-goal-${label}`} className="flex h-16 items-center gap-3 px-5">
              <span className="flex-1 font-bold uppercase tracking-[0.08em]">{label}</span>
              <input
                id={`d-goal-${label}`}
                defaultValue={value}
                inputMode="numeric"
                className="display h-12 w-28 bg-(--tint) px-3 text-right text-[28px] outline-none focus:bg-(--lime-soft)"
              />
              <span className="w-10 font-bold text-muted-foreground text-xs uppercase">{unit}</span>
            </label>
          ))}
        </div>
        <BlockButton tone="ink" className="h-16 text-base">
          Save · from today
        </BlockButton>
      </main>
    </>
  );
}
