import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trend } from "@/design/chart";
import { goals, todayWeight, weights } from "@/design/mock";
import { Card, SectionTitle, TabBar } from "./ui";

const W = 326;
const H = 140;

export function Goals() {
  const t = trend(weights, W, H, 8);
  const area = `${t.avgPath} L${t.raw[t.raw.length - 1]?.x.toFixed(1)} ${H} L${t.raw[6]?.x.toFixed(1)} ${H} Z`;
  return (
    <>
      <header className="px-5 pt-6">
        <p className="font-semibold text-muted-foreground text-sm">Targets and trend</p>
        <h1 className="display mt-0.5 text-[30px]">Goals</h1>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-4 pb-32">
        <section>
          <SectionTitle aside="since 14 Oct">Daily targets</SectionTitle>
          <Card className="divide-y divide-border">
            {(
              [
                ["Energy", goals.kcal, "kcal", 50],
                ["Protein", goals.protein, "g", 5],
                ["Fat", goals.fat, "g", 5],
                ["Carbs", goals.carbs, "g", 10],
                ["Fiber", goals.fiber, "g", 1],
              ] as const
            ).map(([label, value, unit, step]) => (
              <div key={label} className="flex h-16 items-center gap-2 px-3">
                <span className="flex-1 pl-1 font-bold text-[15px]">{label}</span>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-full bg-muted active:bg-border"
                  aria-label={`${label} −${step}`}
                >
                  <Minus className="size-4" strokeWidth={3} />
                </button>
                <input
                  defaultValue={value}
                  inputMode="numeric"
                  className="display h-11 w-16 bg-transparent text-center text-xl outline-none"
                  aria-label={label}
                />
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-full bg-muted active:bg-border"
                  aria-label={`${label} +${step}`}
                >
                  <Plus className="size-4" strokeWidth={3} />
                </button>
                <span className="w-9 text-right font-semibold text-muted-foreground text-xs">{unit}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold text-muted-foreground text-xs">From today onwards</span>
              <Button className="h-11 rounded-full px-5 font-bold">Save</Button>
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle aside={`last ${todayWeight.kg} kg · ${todayWeight.date}`}>Weight</SectionTitle>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 min-w-0 flex-1 items-center rounded-2xl bg-muted px-4">
                <input
                  placeholder={String(todayWeight.kg)}
                  inputMode="decimal"
                  className="display min-w-0 flex-1 bg-transparent text-2xl outline-none placeholder:text-muted-foreground/60"
                  aria-label="Weight"
                />
                <span className="font-bold text-muted-foreground">kg</span>
              </div>
              <Button className="h-14 rounded-full px-6 font-bold">Log</Button>
            </div>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="display text-[30px] leading-none">
                  {t.lastAvg.toFixed(1)}
                  <span className="font-semibold text-muted-foreground text-sm"> kg</span>
                </div>
                <div className="mt-1 font-semibold text-muted-foreground text-xs">7-day average</div>
              </div>
              <span className="rounded-full bg-(--sage-soft) px-2.5 py-1 font-bold text-accent text-xs">
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
              <defs>
                <linearGradient id="pebble-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              {t.ticks.map((tk) => (
                <g key={tk.kg}>
                  <line x1={0} x2={W} y1={tk.y} y2={tk.y} stroke="var(--border)" strokeWidth={1} />
                  <text
                    x={W}
                    y={tk.y - 4}
                    textAnchor="end"
                    fontSize={10}
                    fontWeight={700}
                    fill="var(--muted-foreground)"
                  >
                    {tk.kg.toFixed(0)}
                  </text>
                </g>
              ))}
              <path d={area} fill="url(#pebble-area)" />
              {t.raw.map((p) => (
                <circle key={p.x} cx={p.x} cy={p.y} r={2.5} fill="var(--muted-foreground)" opacity={0.5} />
              ))}
              <path
                d={t.avgPath}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="mt-1 flex justify-between font-semibold text-muted-foreground text-xs">
              <span>29 Sep</span>
              <span>Today</span>
            </div>
          </Card>
        </section>
      </main>

      <TabBar active="goals" />
    </>
  );
}
