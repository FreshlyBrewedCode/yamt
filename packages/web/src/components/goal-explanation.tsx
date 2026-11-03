import { type GoalDerivation, guidedLabel } from "@yamt/shared";
import { cn } from "cn";
import { formatKg } from "@/lib/format";
import { Label } from "./slab";

/**
 * Why a guided goal's targets are what they are (#24): the stored explanation lines (as the
 * algorithm version that made them wrote them), the floors and caps that applied, and the
 * inputs it ran on. On tint, inside a disclosure or a history row.
 */
export function GoalExplanation({
  derivation,
  className,
}: {
  derivation: GoalDerivation;
  className?: string;
}) {
  const { result: r, weight, inputs } = derivation;
  const rows: [string, string[]][] = [
    ["kcal", [r.lines.rmr, r.lines.dailyLife, r.lines.exercise, r.lines.maintenance, r.lines.delta]],
    ["Prot", [r.lines.protein]],
    ["Fat", [r.lines.fat]],
    ["Carb", [r.lines.carbs]],
    ["Fibre", [r.lines.fiber]],
  ];
  return (
    <div className={cn("bg-tint px-5 pt-3 pb-4", className)} data-testid="goal-explanation">
      <Label className="mb-1">{guidedLabel(derivation)}</Label>
      <dl className="divide-y divide-border">
        {rows.map(([label, lines]) => (
          <div key={label} className="flex gap-3 py-2">
            <dt className="w-12 shrink-0 pt-0.5">
              <Label className="text-muted-foreground">{label}</Label>
            </dt>
            <dd className="min-w-0 flex-1 space-y-1 font-medium text-sm">
              {lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {r.notes.length > 0 && (
        <ul className="mt-2 space-y-1 font-medium text-sm">
          {r.notes.map((n) => (
            <li key={n}>■ {n}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 font-medium text-muted-foreground text-sm">
        Worked out from {formatKg(weight.kg)} kg (
        {weight.basis === "average" ? `the 7-day average of ${weight.count} entries` : "the latest entry"}),{" "}
        {inputs.heightCm} cm, age {r.age}. {r.footer}
      </p>
      <Label className="mt-2 text-muted-foreground">Algorithm v{derivation.version}</Label>
    </div>
  );
}
