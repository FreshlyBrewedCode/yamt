import type { NutrientTotals } from "@yamt/shared";
import { cn } from "cn";
import type * as React from "react";
import { formatNumber } from "@/lib/format";
import { Band, Label } from "./slab";

const MACROS = [
  ["protein", "Prot"],
  ["fat", "Fat"],
  ["carbohydrate", "Carb"],
  ["fiber", "Fibre"],
] as const;
type Macro = (typeof MACROS)[number][0];

/** Daily targets, when there are some (#12): the bars and "/160" appear only with them. */
export type Targets = Partial<Record<"energyKcal" | Macro, number>>;

/**
 * The ink totals slab: the hero kcal with its label, something on the right (`aside`), then
 * protein, fat, carbs and fibre. Without `targets` it shows the plain numbers; #12 passes the
 * day's targets and gets a bar per macro (never invented ones).
 */
export function TotalsSlab({
  totals,
  label,
  aside,
  targets,
  className,
  ...props
}: {
  totals: NutrientTotals | null;
  label: string;
  aside?: React.ReactNode;
  targets?: Targets;
} & React.ComponentProps<"section">) {
  const n = totals?.nutrients;
  return (
    <Band tone="ink" className={cn("px-5 pt-4 pb-5", className)} {...props}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="display text-[64px]" data-testid="kcal">
            {n ? formatNumber(n.energyKcal) : "—"}
          </div>
          <Label className="mt-2 text-ink-muted">{label}</Label>
        </div>
        {aside && <div className="pb-1 text-right">{aside}</div>}
      </div>
      {targets?.energyKcal && n && (
        <Bar value={n.energyKcal} target={targets.energyKcal} className="mt-4 h-3" />
      )}
      <div className="mt-4 grid grid-cols-4 gap-3 border-ink-line border-t pt-3">
        {MACROS.map(([key, short]) => {
          const target = targets?.[key];
          return (
            <div key={key}>
              <div className="flex items-baseline gap-0.5">
                <span className="display text-[24px]">{n ? formatNumber(n[key]) : "—"}</span>
                <span className="font-bold text-ink-muted text-xs">{target ? `/${target}` : "g"}</span>
              </div>
              {target && n && <Bar value={n[key]} target={target} className="mt-1.5 h-1.5" />}
              <Label className="mt-1.5 text-ink-muted">{short}</Label>
            </div>
          );
        })}
      </div>
    </Band>
  );
}

function Bar({ value, target, className }: { value: number; target: number; className?: string }) {
  return (
    <div className={cn("w-full bg-ink-line", className)}>
      <div className="h-full bg-lime" style={{ width: `${Math.min(100, (value / target) * 100)}%` }} />
    </div>
  );
}
