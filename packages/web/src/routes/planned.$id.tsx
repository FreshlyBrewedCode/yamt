import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AteItSheet, PlanForSheet } from "@/components/planning";
import { RecipeDetail } from "@/components/recipe-detail";
import { BackButton, SafeBottom } from "@/components/slab";
import { planError, usePlan, usePlannedMeal, useRecipe } from "@/lib/queries";

export const Route = createFileRoute("/planned/$id")({ component: PlannedMealScreen });

/**
 * A planned meal (#40): its recipe to cook from (`RecipeDetail`), with the "Ate it" sheet and the
 * "Plan for" sheet (move, portions, skip, unplan). Logging opens the new meal; unplanning goes to
 * the plan.
 */
function PlannedMealScreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const planned = usePlannedMeal(id);
  const p = planned.data ?? null;
  const recipe = useRecipe(p?.recipeId);
  const plan = usePlan(p?.date ?? "", p?.date ?? "");
  const [ate, setAte] = useState(false);
  const [change, setChange] = useState(false);

  if (!p || !recipe.data) {
    const gone = planned.data === null;
    const error = planned.error ?? recipe.error;
    return (
      <>
        <header className="px-5 pt-5 pb-4">
          <BackButton />
        </header>
        <main className="flex-1 px-5 py-6 font-medium text-muted-foreground" data-testid="planned-missing">
          {gone ? (
            <>
              <p>This meal isn't in the plan any more: it was unplanned.</p>
              <Link
                to="/plan/days"
                className="mt-4 inline-flex min-h-11 items-center font-bold text-foreground"
              >
                Open the plan →
              </Link>
            </>
          ) : error ? (
            <p>{planError(error, "the plan")}</p>
          ) : (
            <p>Loading…</p>
          )}
        </main>
        <SafeBottom />
      </>
    );
  }

  return (
    <>
      <RecipeDetail
        planned={p}
        recipe={recipe.data}
        day={plan.data?.days.find((d) => d.date === p.date)}
        onAte={() => setAte(true)}
        onChange={() => setChange(true)}
        onOpenMeal={() =>
          p.loggedMealId && void navigate({ to: "/meals/$mealId", params: { mealId: p.loggedMealId } })
        }
      />
      <AteItSheet
        planned={ate ? p : null}
        onClose={() => setAte(false)}
        onLogged={({ meal }) => {
          setAte(false);
          void navigate({ to: "/meals/$mealId", params: { mealId: meal.id } });
        }}
      />
      {p.status === "planned" && (
        <PlanForSheet
          planned={p}
          open={change}
          onClose={() => setChange(false)}
          onUnplanned={() => void navigate({ to: "/plan/days", replace: true })}
        />
      )}
    </>
  );
}
