import type { WeightEntry } from "@yamt/shared";
import type * as React from "react";
import { useMemo, useState } from "react";
import { dayLabel, formatKg, formatTime, startOfDay } from "@/lib/format";
import { kgTicks, weightTrend } from "@/lib/weight";
import { Band, Label } from "./slab";

const W = 350;
const H = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;
/** The kg labels' gutter: points and the line start right of it. */
const PAD_LEFT = 26;

/**
 * The weight trend on tint: the latest 7-day average as the number, its change over the window,
 * and a small SVG chart: raw entries as small squares, the moving average as a 2 px line in the
 * foreground colour (lime stays for what wants the user), hairline kg gridlines. Tap or drag on
 * the chart to read a day.
 */
export function WeightTrend({
  entries,
  from,
  now = Date.now(),
}: {
  /** Entries from a week before `from` on, so the average is whole from the start. */
  entries: readonly WeightEntry[];
  from: number;
  now?: number;
}) {
  const t = useMemo(() => {
    const { raw, avg } = weightTrend(entries.map((e) => ({ at: e.measuredAt, kg: e.kg })));
    return { raw: raw.filter((p) => p.at >= from), avg: avg.filter((p) => p.at >= from) };
  }, [entries, from]);
  const [sel, setSel] = useState<number | null>(null);

  if (t.raw.length === 0) {
    return (
      <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="weight-trend">
        <Label className="text-muted-foreground">Trend · 7-day average</Label>
        <p className="mt-2 font-medium text-muted-foreground">
          No weight in the last {Math.round((now - from) / 86_400_000 / 7)} weeks. Log one above and the trend
          starts here.
        </p>
      </Band>
    );
  }

  const values = [...t.raw.map((p) => p.kg), ...t.avg.map((p) => p.kg)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // at least 2 kg tall, so day-to-day noise doesn't look like a cliff
  if (hi - lo < 2) {
    const mid = (hi + lo) / 2;
    lo = mid - 1;
    hi = mid + 1;
  }
  lo -= 0.2;
  hi += 0.2;
  const to = startOfDay(now, 1);
  const x = (at: number) => PAD_LEFT + ((at - from) / (to - from)) * (W - PAD_LEFT - 4);
  const y = (kg: number) => PAD_TOP + ((hi - kg) / (hi - lo)) * (H - PAD_TOP - PAD_BOTTOM);
  const path = t.avg.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.kg).toFixed(1)}`).join("");
  const last = t.avg.at(-1)!;
  const first = t.avg[0]!;
  const delta = last.kg - first.kg;
  const weeks = Math.max(1, Math.round((last.at - first.at) / (7 * 86_400_000)));
  const picked = sel === null ? null : t.raw[sel];
  const pickedAvg = picked ? t.avg.findLast((a) => a.at - 12 * 3_600_000 <= picked.at) : null;

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const at = from + ((px - PAD_LEFT) / (W - PAD_LEFT - 4)) * (to - from);
    let best = 0;
    t.raw.forEach((p, i) => {
      if (Math.abs(p.at - at) < Math.abs(t.raw[best]!.at - at)) best = i;
    });
    setSel(best);
  };

  return (
    <Band tone="tint" className="px-5 pt-4 pb-4" data-testid="weight-trend">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="display text-[40px]" data-testid="weight-avg">
            {formatKg(last.kg)}
          </div>
          <Label className="mt-1 text-muted-foreground">kg · 7-day average</Label>
        </div>
        {t.avg.length > 1 && (
          <div className="bg-ink px-2.5 py-1.5 font-bold text-ink-foreground" data-testid="weight-delta">
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
            {formatKg(Math.abs(delta))} kg / {weeks} wk
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Weight trend: ${t.raw.length} entries, 7-day average ${formatKg(last.kg)} kg`}
        onPointerDown={pick}
        onPointerMove={(e) => e.buttons > 0 && pick(e)}
      >
        {kgTicks(lo, hi).map((kg) => (
          <g key={kg}>
            <line x1={PAD_LEFT - 4} x2={W} y1={y(kg)} y2={y(kg)} stroke="var(--border)" strokeWidth={1} />
            <text x={0} y={y(kg) + 4} fontSize={11} fontWeight={700} fill="var(--muted-foreground)">
              {Number.isInteger(kg) ? kg : kg.toFixed(1)}
            </text>
          </g>
        ))}
        {t.raw.map((p, i) => (
          <rect
            key={p.at}
            x={x(p.at) - 2.5}
            y={y(p.kg) - 2.5}
            width={5}
            height={5}
            fill="var(--muted-foreground)"
            opacity={sel === i ? 1 : 0.6}
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {picked && (
          <g>
            <line
              x1={x(picked.at)}
              x2={x(picked.at)}
              y1={0}
              y2={H}
              stroke="var(--foreground)"
              strokeWidth={1}
              opacity={0.5}
            />
            <rect
              x={x(picked.at) - 5}
              y={y(picked.kg) - 5}
              width={10}
              height={10}
              fill="var(--foreground)"
              stroke="var(--tint)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <div className="mt-1 flex min-h-5 justify-between gap-3">
        {picked ? (
          <Label className="text-foreground" role="status" data-testid="weight-readout">
            {dayLabel(startOfDay(picked.at), now)} {formatTime(picked.at)} · {formatKg(picked.kg)} kg
            {pickedAvg && ` · avg ${formatKg(pickedAvg.kg)}`}
          </Label>
        ) : (
          <>
            <Label className="text-muted-foreground">{dayLabel(startOfDay(from), now)}</Label>
            <Label className="text-muted-foreground">Today</Label>
          </>
        )}
      </div>
    </Band>
  );
}
