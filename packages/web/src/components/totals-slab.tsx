import type { NutrientTotals, Targets } from "@yamt/shared";
import { cn } from "cn";
import type * as React from "react";
import { formatNumber } from "@/lib/format";
import { Band, Label } from "./slab";

const MACROS = [
  ["protein", "Prot", "Protein"],
  ["fat", "Fat", "Fat"],
  ["carbohydrate", "Carb", "Carbs"],
  ["fiber", "Fibre", "Fibre"],
] as const;

/**
 * The ink totals slab: the hero kcal with its label, something on the right (`aside`), then
 * protein, fat, carbs and fibre, and an optional `note` under a thin line (e.g. meals not
 * counted yet). With `targets` (the goal in force, #12) the right side says how much is left of
 * the kcal target (or how far over), and every target gets "/160" and a bar; `showLeft` adds
 * each macro's "88 left" / "12 over". Without targets it shows the plain numbers, never
 * invented goals.
 */
export function TotalsSlab({
  totals,
  label,
  aside,
  targets,
  showLeft = false,
  note,
  className,
  ...props
}: {
  totals: NutrientTotals | null;
  label: string;
  aside?: React.ReactNode;
  targets?: Targets | null;
  showLeft?: boolean;
  note?: React.ReactNode;
} & React.ComponentProps<"section">) {
  const n = totals?.nutrients;
  const kcalTarget = targets?.energyKcal ?? null;
  const eatenKcal = n?.energyKcal ?? 0;
  const right =
    aside ?? (kcalTarget !== null ? <KcalLeft eaten={eatenKcal} target={kcalTarget} /> : undefined);
  return (
    <Band tone="ink" className={cn("px-5 pt-4 pb-5", className)} {...props}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="display text-[64px]" data-testid="kcal">
            {n ? formatNumber(n.energyKcal) : "—"}
          </div>
          <Label className="mt-2 text-ink-muted">{label}</Label>
        </div>
        {right && <div className="pb-1 text-right">{right}</div>}
      </div>
      {kcalTarget !== null && (
        <TargetBar value={eatenKcal} target={kcalTarget} what="kcal" className="mt-4 h-3" />
      )}
      <div className="mt-4 grid grid-cols-4 gap-3 border-ink-line border-t pt-3">
        {MACROS.map(([key, short, long]) => {
          const target = targets?.[key] ?? null;
          const value = n?.[key] ?? 0;
          const left = target === null ? null : Math.round(target - value);
          return (
            <div key={key} data-testid={`macro-${key}`} data-over={left !== null && left < 0}>
              <div className="flex items-baseline gap-0.5">
                <span className="display text-[24px]">{n ? formatNumber(value) : "—"}</span>
                <span className="font-bold text-ink-muted text-xs">
                  {target !== null ? `/${formatNumber(target)}` : "g"}
                </span>
              </div>
              {target !== null && (
                <TargetBar value={value} target={target} what={`g ${long}`} className="mt-1.5 h-1.5" />
              )}
              <Label className="mt-1.5 text-ink-muted">{short}</Label>
              {showLeft && left !== null && (
                <div className="mt-0.5 font-bold text-[11px] uppercase tracking-[0.06em]">
                  {left < 0 ? `${formatNumber(-left)} over` : `${formatNumber(left)} left`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {note && (
        <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
          {note}
        </Label>
      )}
    </Band>
  );
}

/** "1,202 left of 2,400" in lime, or "+210 over 2,400" in the slab's own colour (never red). */
function KcalLeft({ eaten, target }: { eaten: number; target: number }) {
  const left = Math.round(target - eaten);
  const over = left < 0;
  return (
    <div data-testid="kcal-left" data-over={over}>
      <div className={cn("display text-[28px]", !over && "text-lime")}>
        {over ? `+${formatNumber(-left)}` : formatNumber(left)}
      </div>
      <Label className="mt-1 text-ink-muted">
        {over ? "over" : "left of"} {formatNumber(target)}
      </Label>
    </div>
  );
}

/**
 * Progress against a target on the ink slab: lime up to the target. Past it the bar rescales so
 * the target sits where the lime ends, a 2 px gap marks it, and the excess is filled in the
 * slab's foreground (paper on ink). "Over" is a fact, not an alarm: no red, and orange stays for
 * failures.
 */
export function TargetBar({
  value,
  target,
  what,
  className,
}: {
  value: number;
  target: number;
  /** For the label: "kcal", "g Protein". */
  what: string;
  className?: string;
}) {
  const scale = Math.max(value, target, 1);
  const under = (Math.min(value, target) / scale) * 100;
  const over = value > target ? ((value - target) / scale) * 100 : 0;
  return (
    <div
      className={cn("flex w-full bg-ink-line", className)}
      role="img"
      aria-label={`${formatNumber(value)} of ${formatNumber(target)} ${what}`}
    >
      <div className="h-full bg-lime" style={{ width: `${under}%` }} />
      {over > 0 && (
        <>
          <div className="h-full w-0.5 shrink-0 bg-ink" />
          <div className="h-full bg-ink-foreground" style={{ width: `${over}%` }} data-testid="over" />
        </>
      )}
    </div>
  );
}
