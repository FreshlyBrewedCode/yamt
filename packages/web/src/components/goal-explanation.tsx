import { GOAL_RESEARCH_URL, type GoalDerivation, goalMethod, guidedLabel, METHOD_FOOTER } from "@yamt/shared";
import { cn } from "cn";
import { formatKg } from "@/lib/format";
import { Disclosure, Label } from "./slab";

/**
 * Why a guided goal's targets are what they are (#24): the stored explanation lines (as the
 * algorithm version that made them wrote them), the floors and caps that applied, the inputs it
 * ran on, and how that version calculates. On tint, inside a disclosure or a history row.
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
      <GoalMethod version={derivation.version} className="-mx-5 mt-3 border-border border-t border-b-0" />
    </div>
  );
}

/**
 * "How this is calculated" (#24): every formula of an algorithm version with its short
 * citation, that the numbers are a starting estimate, and a link to the research report. A
 * disclosure, closed: the explanation lines already name the formulas, this is for who asks.
 */
export function GoalMethod({ version, className }: { version: number; className?: string }) {
  return (
    <Disclosure title="How this is calculated" className={className} data-testid="goal-method">
      <div className="bg-tint px-5 pt-1 pb-4">
        <dl className="divide-y divide-border">
          {goalMethod(version).map((m) => (
            <div key={m.label} className="py-2.5">
              <dt>
                <Label className="text-muted-foreground">{m.label}</Label>
              </dt>
              <dd className="mt-1 font-medium text-sm leading-snug">{m.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 font-medium text-sm leading-snug">{METHOD_FOOTER}</p>
        <a
          href={GOAL_RESEARCH_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block font-bold text-sm underline underline-offset-4"
          data-testid="goal-research"
        >
          The research behind it, on GitHub
        </a>
      </div>
    </Disclosure>
  );
}
