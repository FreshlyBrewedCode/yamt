// The frame every round 2 variant sits in: the overview (split slab, request rows), the recipe
// detail and the Ate-it sheet (round 1's, unchanged), C's plan view, the Plan-for sheet for a
// changed pick. The variant renders only its composer and thread screens through `compose`.
import { CalendarDays, Scale, Settings } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { iconButtonClass } from "@/components/slab";
import { PlanViewC } from "../c/page";
import { PLANNED, RECIPES, type Recipe } from "../mock";
import { AteSheet, OverviewMock, PlanSheet, RecipeScreen } from "../shared";
import type { Screen, Screen2 } from "../variants";
import { AFTER_ROUND_1, AFTER_ROUND_2, pickedMeals, RequestRows, SplitSlab, type Verdicts } from "./parts";

export interface Ctx {
  screen: Screen2;
  go: (s: Screen2) => void;
  verdicts: Verdicts;
  setVerdicts: (v: Verdicts) => void;
  openRecipe: (r: Recipe) => void;
  change: (r: Recipe) => void;
}

const initialVerdicts = (screen: Screen2): Verdicts =>
  screen === "round2" ? AFTER_ROUND_2 : screen === "steer" ? AFTER_ROUND_1 : {};

export function Frame({
  screen,
  go,
  compose,
}: {
  screen: Screen2;
  go: (s: Screen2) => void;
  compose: (ctx: Ctx) => React.ReactNode;
}) {
  return <Inner key={screen} screen={screen} go={go} compose={compose} />;
}

function Inner({
  screen,
  go,
  compose,
}: {
  screen: Screen2;
  go: (s: Screen2) => void;
  compose: (ctx: Ctx) => React.ReactNode;
}) {
  const [ate, setAte] = useState(false);
  const [open, setOpen] = useState<Recipe | null>(null);
  const [planFor, setPlanFor] = useState<Recipe | null>(null);
  const [verdicts, setVerdicts] = useState<Verdicts>(() => initialVerdicts(screen));
  const tonight = PLANNED[0]!;

  if (open) {
    return (
      <>
        <RecipeScreen
          recipe={open}
          planned={null}
          onBack={() => setOpen(null)}
          onAte={() => {}}
          onPlan={() => setPlanFor(open)}
        />
        <PlanSheet
          recipe={planFor}
          open={planFor !== null}
          onClose={() => setPlanFor(null)}
          onPlan={(date, slot) => {
            setVerdicts({ ...verdicts, [open.id]: { kind: "picked", date, slot } });
            setPlanFor(null);
            setOpen(null);
          }}
        />
      </>
    );
  }

  if (screen === "overview") {
    return (
      <>
        <OverviewMock
          onOpenPlanned={() => setOpen(RECIPES.get(tonight.recipeId)!)}
          onAte={() => setAte(true)}
          headerRight={
            <>
              <span className={iconButtonClass} aria-hidden>
                <CalendarDays className="size-6" strokeWidth={2.5} />
              </span>
              <span className={iconButtonClass} aria-hidden>
                <Scale className="size-6" strokeWidth={2.5} />
              </span>
              <span className={iconButtonClass} aria-hidden>
                <Settings className="size-6" strokeWidth={2.5} />
              </span>
            </>
          }
          beforeToday={<RequestRows onOpen={() => go("suggestions")} />}
          slab={<SplitSlab onLog={() => {}} onPlan={() => go("empty")} />}
        />
        <AteSheet
          recipe={RECIPES.get(tonight.recipeId)!}
          factor={tonight.factor}
          open={ate}
          onClose={() => setAte(false)}
          onLogged={() => setAte(false)}
        />
      </>
    );
  }

  if (screen === "plan") {
    const map: Partial<Record<Screen, Screen2>> = {
      request: "empty",
      suggestions: "round2",
      overview: "overview",
    };
    return <PlanViewC go={(s) => go(map[s] ?? "overview")} onOpen={(r) => setOpen(r)} />;
  }

  return (
    <>
      {compose({ screen, go, verdicts, setVerdicts, openRecipe: setOpen, change: setPlanFor })}
      <PlanSheet
        recipe={planFor}
        open={planFor !== null}
        planned={pickedMeals(verdicts)}
        defaultDate={
          (planFor &&
            verdicts[planFor.id]?.kind === "picked" &&
            (verdicts[planFor.id] as { date: string }).date) ||
          "2026-11-05"
        }
        onClose={() => setPlanFor(null)}
        onPlan={(date, slot) => {
          if (planFor) setVerdicts({ ...verdicts, [planFor.id]: { kind: "picked", date, slot } });
          setPlanFor(null);
        }}
      />
    </>
  );
}
