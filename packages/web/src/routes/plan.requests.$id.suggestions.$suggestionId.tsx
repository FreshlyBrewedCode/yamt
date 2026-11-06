import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SuggestionDetail } from "@/components/recipe-detail";
import { BackButton, SafeBottom } from "@/components/slab";
import { localDate } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { pickTarget } from "@/lib/plan-request";
import {
  planError,
  usePickSuggestion,
  usePlan,
  usePlanningRequest,
  useRecipe,
  useRejectSuggestion,
} from "@/lib/queries";

export const Route = createFileRoute("/plan/requests/$id/suggestions/$suggestionId")({
  component: SuggestionScreen,
});

/**
 * A suggestion's recipe (#47): #40's recipe detail in suggestion mode, from a band's title. Pick
 * takes the slot the band names; a picked one opens its planned meal.
 */
function SuggestionScreen() {
  const { id, suggestionId } = Route.useParams();
  const today = localDate(Date.now());
  const q = usePlanningRequest(id);
  const detail = q.data ?? null;
  const round = detail?.rounds.find((r) => r.suggestions.some((s) => s.id === suggestionId));
  const s = round?.suggestions.find((x) => x.id === suggestionId);
  const recipe = useRecipe(s?.recipeId ?? undefined);
  const f = detail?.request.filters;
  const plan = usePlan(f?.days[0] ?? "", f?.days.at(-1) ?? "");
  const pick = usePickSuggestion(id);
  const reject = useRejectSuggestion(id);
  const [pickId] = useState(() => uuidv7());

  if (!detail || !round || !s || !recipe.data) {
    const error = q.error ?? recipe.error;
    return (
      <>
        <header className="px-5 pt-5 pb-4">
          <BackButton fallback="/plan" />
        </header>
        <main className="flex-1 px-5 py-6 font-medium text-muted-foreground" data-testid="suggestion-missing">
          {error ? (
            <p>{planError(error, "this suggestion")}</p>
          ) : q.isPending || recipe.isPending ? (
            <p>Loading…</p>
          ) : (
            <p>This suggestion isn't ready.</p>
          )}
        </main>
        <SafeBottom />
      </>
    );
  }

  const target =
    s.verdict === "picked" && s.fit
      ? { date: s.fit.date, slot: s.fit.slot }
      : pickTarget(s, detail.request, plan.data?.days, today);
  const error = pick.error ?? reject.error;
  return (
    <SuggestionDetail
      suggestion={s}
      round={round.number}
      recipe={recipe.data}
      target={target}
      portionsCooked={detail.request.filters.portionsCooked}
      onPick={() => pick.mutate({ suggestionId: s.id, body: { id: pickId } })}
      onUnreject={() => reject.mutate({ suggestionId: s.id, reject: false })}
      picking={pick.isPending || reject.isPending}
      error={error ? planError(error, "picking") : null}
    />
  );
}
