import type { AnalysisRun, Capture, CaptureKind, MealRevision, MealRevisionView } from "@yamt/shared";
import { cn } from "cn";
import { useState } from "react";
import { captureSummary, formatDayTime, formatDelta, formatGrams, formatNumber } from "@/lib/format";
import { useRevisions } from "@/lib/queries";
import { ProvenanceTag } from "./items-list";
import { Disclosure, Label } from "./slab";
import { runMeta, TraceView } from "./trace-view";

/** What arrived between the revision before and this one ("after 1 answer · 1 correction"). */
function trigger(captures: Capture[], revision: MealRevision, from: number | null): string {
  if (revision.kind === "copy") return "logged again";
  if (revision.kind === "plan") return "logged from the plan";
  const to = revision.createdAt;
  if (from === null) return "first analysis";
  const kinds: Partial<Record<CaptureKind, number>> = {};
  for (const c of captures) {
    if (c.createdAt > from && c.createdAt <= to) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  }
  const what = captureSummary(kinds);
  return what ? `after ${what}` : "analysed again";
}

/**
 * Every revision of the meal, newest first, with its kcal and the change from the one before,
 * so a correction's effect is visible. A row opens to its items, assumptions, questions and the
 * trace of the run that wrote it. Fetches when it mounts (inside a Disclosure: when opened).
 */
export function RevisionHistory({
  mealId,
  captures,
  runs,
  currentId,
}: {
  mealId: string;
  captures: Capture[];
  runs: AnalysisRun[];
  currentId: string | null;
}) {
  const q = useRevisions(mealId, true);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <p className="px-5 py-4 font-medium text-muted-foreground text-sm">Loading…</p>;
  if (q.isError) {
    return (
      <p className="px-5 py-4 font-medium text-muted-foreground text-sm">
        Couldn't load them: {q.error.message}
      </p>
    );
  }
  const list = q.data.revisions;
  return (
    <ol className="divide-y divide-border bg-tint" data-testid="revisions">
      {list.map((v, i) => {
        const r = v.revision;
        const before = list[i + 1] ?? null;
        const kcal = v.totals.nutrients.energyKcal;
        const expanded = open === r.id;
        return (
          <li key={r.id} data-testid="revision" data-number={r.number}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : r.id)}
              aria-expanded={expanded}
              className="block min-h-[68px] w-full px-5 py-3 text-left outline-none focus-visible:bg-background/50"
            >
              <div className="flex items-baseline gap-3">
                <span className="display text-[19px] tracking-[-0.02em]">Revision {r.number}</span>
                {r.id === currentId && <Label className="text-muted-foreground">current</Label>}
                <span className="ml-auto display text-[22px]">{formatNumber(kcal)}</span>
                <span className="w-12 text-right font-bold text-muted-foreground text-xs">
                  {before ? formatDelta(kcal - before.totals.nutrients.energyKcal) : "kcal"}
                </span>
              </div>
              <Label className="mt-1 text-muted-foreground">
                {formatDayTime(r.createdAt)} · {r.status === "needs_input" ? "needs input" : "analysed"} ·{" "}
                {trigger(captures, r, before?.revision.createdAt ?? null)}
              </Label>
              <p className="mt-1 truncate font-medium text-sm">{r.title}</p>
            </button>
            {expanded && <RevisionBody view={v} run={runs.find((x) => x.id === r.runId) ?? null} />}
          </li>
        );
      })}
    </ol>
  );
}

function RevisionBody({ view, run }: { view: MealRevisionView; run: AnalysisRun | null }) {
  const n = view.totals.nutrients;
  return (
    <div className="bg-background" data-testid="revision-body">
      <p className="px-5 pt-3 font-bold text-sm">
        Prot {formatGrams(n.protein)} g · Fat {formatGrams(n.fat)} g · Carb {formatGrams(n.carbohydrate)} g ·
        Fibre {formatGrams(n.fiber)} g
      </p>
      <ul className="mt-2 divide-y divide-border">
        {view.items.map((it) => (
          <li
            key={it.id}
            className={cn("flex items-baseline gap-3 px-5 py-2", it.confidence === "low" && "bg-lime-soft")}
          >
            <span className="min-w-0 flex-1 truncate font-medium text-sm">{it.description}</span>
            <ProvenanceTag provenance={it.provenance} className="text-muted-foreground" />
            <span className="w-12 text-right font-bold text-sm">{formatGrams(it.grams)} g</span>
            <span className="w-10 text-right font-medium text-muted-foreground text-sm">
              {it.nutrients.energyKcal === null ? "—" : formatNumber(it.nutrients.energyKcal)}
            </span>
          </li>
        ))}
      </ul>
      {view.revision.assumptions.length > 0 && (
        <div className="px-5 pt-3 pb-1">
          <Label className="text-muted-foreground">Assumed</Label>
          <ul className="mt-1 space-y-1 font-medium text-sm">
            {view.revision.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {view.questions.length > 0 && (
        <div className="px-5 pt-3 pb-1">
          <Label className="text-muted-foreground">Asked</Label>
          <ul className="mt-1 space-y-1 text-sm">
            {view.questions.map((q) => (
              <li key={q.id}>
                <span className="font-bold">{q.question}</span>{" "}
                <span className="font-medium text-muted-foreground">
                  {q.answer
                    ? `→ ${q.answer}`
                    : q.answeredByCaptureId
                      ? "→ (spoken answer)"
                      : "→ not answered"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {run ? (
        <Disclosure title="Trace" meta={runMeta(run)} className="mt-2 border-t">
          <TraceView run={run} />
        </Disclosure>
      ) : (
        <p className="px-5 py-3 font-medium text-muted-foreground text-sm">
          {view.revision.kind === "copy"
            ? "Logged again from another meal: its items were copied, nothing was analysed (no run)."
            : "Saved in an interactive session (no run)."}
        </p>
      )}
    </div>
  );
}
