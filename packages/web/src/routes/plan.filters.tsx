import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Check, RotateCcw } from "lucide-react";
import { FilterForm } from "@/components/plan-request";
import { BackButton, Band, BottomSlab, Label, SlabButton } from "@/components/slab";
import { localDate } from "@/lib/format";
import { ENTRY_DRAFT, useDraft } from "@/lib/plan-draft";
import { draftProblem, filterDefaults, requestSentence, resolveDraft } from "@/lib/plan-request";
import { usePlanningSettings } from "@/lib/queries";

export const Route = createFileRoute("/plan/filters")({ component: PlanFilters });

/**
 * The filter page (#47): the request as the agent will read it (the ink slab, one sentence from the
 * filters), then every filter, the recipe source, portions to cook and how many suggestions;
 * defaults from Settings → Planning. Changes land in the entry screen's draft at once; lime Done
 * goes back to it.
 */
function PlanFilters() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const today = localDate(Date.now());
  const settings = usePlanningSettings();
  const [draft, setDraft] = useDraft(ENTRY_DRAFT);
  const defaults = filterDefaults(settings.data?.settings);
  const filters = resolveDraft(draft.filters, defaults, today);
  const problem = draftProblem(filters);
  const done = () => (canGoBack ? router.history.back() : void navigate({ to: "/plan" }));
  const changed = Object.keys(draft.filters).length > 0;

  return (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <BackButton fallback="/plan" />
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Request</Label>
          <h1 className="display mt-1 text-[36px]">Filters</h1>
        </div>
      </header>
      <main className="flex-1">
        <Band tone="ink" className="px-5 pt-4 pb-5" data-testid="request-sentence">
          <Label className="text-ink-muted">How the agent reads it</Label>
          <p className="display mt-2 text-[24px] leading-[1.05] tracking-[-0.03em]">
            {requestSentence(filters, today)}
          </p>
          <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
            Plus what you type, say and attach · your goal, recent meals and preferences
          </Label>
        </Band>
        <FilterForm
          draft={draft.filters}
          filters={filters}
          defaults={defaults}
          today={today}
          onChange={(f) => setDraft((d) => ({ ...d, filters: f }))}
        />
        {changed && (
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, filters: {} }))}
            className="flex min-h-14 w-full items-center justify-between gap-3 border-border border-t px-5 text-left font-bold uppercase tracking-[0.08em] outline-none active:bg-tint focus-visible:bg-tint"
            data-testid="reset-filters"
          >
            Back to the defaults
            <RotateCcw className="size-5 text-muted-foreground" strokeWidth={2.5} />
          </button>
        )}
      </main>
      <BottomSlab hint={problem ?? undefined}>
        <SlabButton onClick={done} data-testid="filters-done">
          <Check className="size-8" strokeWidth={3} /> Done
        </SlabButton>
      </BottomSlab>
    </>
  );
}
