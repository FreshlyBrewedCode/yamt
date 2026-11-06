// The recipe to cook from (#40, G's recipe detail): for a planned meal now, for a suggestion once
// the planning screens exist. Numbers per portion against what is open on its day (the ink slab),
// changes and notes on tint, Cook / Eat portions, the ingredients for the portions cooked, the
// steps, and where it comes from.
import { Link } from "@tanstack/react-router";
import type { PlanDay, PlannedMealView, RecipeView } from "@yamt/shared";
import { cn } from "cn";
import {
  CalendarClock,
  Check,
  Clock,
  ExternalLink,
  Globe,
  type LucideIcon,
  RotateCcw,
  Sparkles,
  Square,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { dateStart, dayLabel, formatGrams, formatNumber, localDate, plural } from "@/lib/format";
import { canEat, gramsFor, openBefore, sourceLabel, sourceName } from "@/lib/planning";
import { planError, useSkipPlannedMeal, useUpdatePlannedMeal } from "@/lib/queries";
import { FitBar, OpenGrid, PortionChips, portions, whenWords } from "./planning";
import { BackButton, Band, BottomSlab, iconButtonClass, Label, SlabButton, Strip } from "./slab";

const sourceIcon: Record<RecipeView["recipe"]["sourceMode"], LucideIcon> = {
  published: Globe,
  adapted: Globe,
  composed: Sparkles,
};

/** What the source footer says about the numbers. */
const sourceNote: Record<RecipeView["recipe"]["sourceMode"], string> = {
  published: "As published; nutrition computed from the matched ingredients, not from the page.",
  adapted: "Adapted; nutrition computed from the matched ingredients, not from the page.",
  composed: "Composed for you; every ingredient matched to real foods, nutrition computed from them.",
};

/**
 * A planned meal's recipe. `day` is the plan of its date (for what is open there); the bottom
 * slab is lime **Ate it** when it is due (today or earlier, still planned), else a tint **Change
 * day · portions**; a skipped one offers Unskip (the undo), a logged one opens its meal.
 */
export function RecipeDetail({
  planned,
  recipe,
  day,
  onAte,
  onChange,
  onOpenMeal,
}: {
  planned: PlannedMealView;
  recipe: RecipeView;
  day: PlanDay | undefined;
  onAte: () => void;
  onChange: () => void;
  onOpenMeal: () => void;
}) {
  const r = recipe.recipe;
  const now = Date.now();
  const today = localDate(now);
  const status = planned.status;
  const update = useUpdatePlannedMeal();
  const skip = useSkipPlannedMeal();
  // the chips answer at once; the server's answer replaces them
  const [pending, setPending] = useState<{ cook: number; eat: number } | null>(null);
  const cook = pending?.cook ?? planned.portionsCooked;
  const eat = pending?.eat ?? planned.portionEaten;
  // what the plan counts (the server's numbers); while new portions are on their way, scaled here
  const per = recipe.perPortion.nutrients;
  const dish = pending
    ? {
        energyKcal: per.energyKcal * eat,
        protein: per.protein * eat,
        fat: per.fat * eat,
        carbohydrate: per.carbohydrate * eat,
        fiber: per.fiber * eat,
      }
    : planned.eaten.nutrients;
  const { base, open } = openBefore(day, planned);
  const target = day?.goal?.targets.energyKcal ?? null;
  const dayWord = planned.date === today ? "today" : dayLabel(dateStart(planned.date), now);
  const leftover = cook - eat;
  const SourceIcon = sourceIcon[r.sourceMode];
  const name = sourceName(r);
  const lead = status === "logged" ? "Logged" : status === "skipped" ? "Skipped" : "Planned";

  const setPortions = (v: { cook: number; eat: number }) => {
    setPending(v);
    update.mutate(
      {
        id: planned.id,
        body: {
          ...(v.cook !== planned.portionsCooked ? { portionsCooked: v.cook } : {}),
          ...(v.eat !== planned.portionEaten ? { portionEaten: v.eat } : {}),
        },
      },
      { onSettled: () => setPending(null) },
    );
  };

  return (
    <>
      <header className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <BackButton />
          {status === "planned" && (
            <button
              type="button"
              onClick={onChange}
              className={iconButtonClass}
              aria-label="Change day or portions"
              data-testid="change-plan"
            >
              <CalendarClock className="size-6" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <Label className="mt-4 text-muted-foreground" data-testid="planned-when">
          {lead} · {whenWords(planned, now)} · cook {cook}, eat {portions(eat)}
        </Label>
        <h1 className="display mt-1 text-[32px] leading-[0.95]" data-testid="recipe-title">
          {r.title}
        </h1>
        {r.summary && (
          <p className="mt-2 font-medium text-[15px] text-muted-foreground leading-snug">{r.summary}</p>
        )}
        {r.sourceUrl ? (
          <a
            href={r.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="-mb-2 mt-1 flex min-h-11 items-center gap-1.5 font-bold text-muted-foreground text-xs uppercase tracking-[0.08em] outline-none focus-visible:underline"
            data-testid="recipe-source"
          >
            <SourceIcon className="size-3.5 shrink-0" strokeWidth={2.5} /> {sourceLabel(r)}
          </a>
        ) : (
          <Label className="mt-2 flex items-center gap-1.5 text-muted-foreground" data-testid="recipe-source">
            <SourceIcon className="size-3.5 shrink-0" strokeWidth={2.5} /> {sourceLabel(r)}
          </Label>
        )}
      </header>

      <main className="flex-1">
        {status === "skipped" && <SkippedBand planned={planned} dayWord={dayWord} />}
        {status === "logged" && planned.loggedMealId && (
          <Link
            to="/meals/$mealId"
            params={{ mealId: planned.loggedMealId }}
            className="flex min-h-14 items-center justify-between gap-3 bg-tint px-5 py-2 outline-none active:opacity-70 focus-visible:underline"
            data-testid="logged-band"
          >
            <span className="flex items-center gap-2 font-bold">
              <Check className="size-4" strokeWidth={3} /> Logged as a meal
            </span>
            <Label className="text-muted-foreground">Open meal →</Label>
          </Link>
        )}

        {/* the one thing here: what a portion brings, against what its day has open */}
        <Band tone="ink" className="px-5 pt-4 pb-5" data-testid="recipe-numbers">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]" data-testid="kcal">
                {formatNumber(dish.energyKcal)}
              </div>
              <Label className="mt-2 text-ink-muted">
                kcal {eat === 1 ? "per portion" : `for ${portions(eat)} portions`}
              </Label>
            </div>
            {open.energyKcal !== null && (
              <div className="pb-1 text-right" data-testid="open-kcal">
                <div
                  className={cn("display text-[28px]", open.energyKcal - dish.energyKcal >= 0 && "text-lime")}
                >
                  {formatNumber(Math.max(0, open.energyKcal))}
                </div>
                <Label className="mt-1 text-ink-muted">open {dayWord}</Label>
              </div>
            )}
          </div>
          {target !== null && (
            <FitBar base={base.energyKcal} dish={dish.energyKcal} target={target} className="mt-4" />
          )}
          <OpenGrid dish={dish} open={open} className="mt-4 border-ink-line border-t pt-3" />
          {(r.timeActiveMin !== null || r.timeTotalMin !== null) && (
            <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
              <Clock className="size-3.5" strokeWidth={2.5} />
              {[
                r.timeActiveMin !== null ? `${r.timeActiveMin} min active` : "",
                r.timeTotalMin !== null ? `${r.timeTotalMin} min total` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Label>
          )}
        </Band>

        {(r.changes.length > 0 || r.notes || planned.note) && (
          <Band tone="tint" className="divide-y divide-border px-5" data-testid="recipe-notes">
            {r.sourceMode === "adapted" && r.changes.length > 0 && (
              <div className="pt-4 pb-4">
                <Label className="text-muted-foreground">Changed against {name ?? "the source"}</Label>
                <ul className="mt-2 space-y-1">
                  {r.changes.map((c) => (
                    <li key={c} className="flex items-start gap-2 font-medium text-[15px] leading-snug">
                      <Square className="mt-1.5 size-2 shrink-0" strokeWidth={3} />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.notes && (
              <div className="pt-4 pb-4">
                <Label className="text-muted-foreground">Notes</Label>
                <p className="mt-1 whitespace-pre-line font-medium text-[15px] leading-snug">{r.notes}</p>
              </div>
            )}
            {planned.note && (
              <div className="pt-4 pb-4">
                <Label className="text-muted-foreground">Your note</Label>
                <p className="mt-1 whitespace-pre-line font-medium text-[15px] leading-snug">
                  {planned.note}
                </p>
              </div>
            )}
          </Band>
        )}

        <section aria-label="Portions">
          <Strip title="Portions" meta={leftover > 0 ? plural(leftover, "leftover") : "nothing left over"} />
          <div className="px-5 pt-4 pb-4" data-testid="portions">
            <PortionChips
              cook={cook}
              eat={eat}
              onChange={setPortions}
              disabled={status !== "planned" || update.isPending}
              eatLabel={`Eat ${dayWord}`}
            />
            {leftover > 0 && (
              <p
                className="mt-3 flex items-start gap-2.5 font-medium text-[15px] leading-snug"
                data-testid="leftover"
              >
                <Utensils className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                <span>
                  {portions(leftover)} {leftover === 1 ? "portion" : "portions"} (
                  {formatNumber(recipe.perPortion.nutrients.energyKcal * leftover)} kcal) more than you eat: a
                  leftover.
                </span>
              </p>
            )}
          </div>
          {update.isError && (
            <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
              {planError(update.error, "changing the portions")}
            </p>
          )}
        </section>

        <section aria-label="Ingredients">
          <Strip title="Ingredients" meta={`for ${plural(cook, "portion")} cooked`} />
          <ul className="divide-y divide-border" data-testid="ingredients">
            {recipe.items.map((i) => (
              <li key={i.id} className="flex min-h-12 items-center gap-3 px-5 py-2" data-testid="ingredient">
                <span className="min-w-0 flex-1 font-bold text-[15px] leading-snug">
                  {i.description}
                  {i.optional && (
                    <span className="ml-2 font-medium text-muted-foreground text-xs">optional</span>
                  )}
                </span>
                <span className="display shrink-0 text-[20px]">
                  {formatGrams(gramsFor(r, i, cook))}
                  <span className="font-bold text-muted-foreground text-xs">g</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {r.steps.length > 0 && (
          <section aria-label="Steps">
            <Strip title="Steps" meta={r.steps.length} />
            <ol className="divide-y divide-border">
              {r.steps
                .map((text, i) => ({ text, number: i + 1 }))
                .map((step) => (
                  <li key={step.number} className="flex items-start gap-4 px-5 py-3">
                    <span className="display flex size-8 shrink-0 items-center justify-center bg-tint text-[18px]">
                      {step.number}
                    </span>
                    <span className="pt-1 font-medium text-[15px] leading-snug">{step.text}</span>
                  </li>
                ))}
            </ol>
          </section>
        )}

        <div className="flex min-h-14 items-center gap-3 bg-tint px-5 py-3" data-testid="source-footer">
          <SourceIcon className="size-5 shrink-0" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 font-bold text-sm">
            {r.sourceUrl ? (
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                {name ?? "The source"} <ExternalLink className="size-3.5" strokeWidth={2.5} />
              </a>
            ) : (
              (name ?? (r.sourceMode === "composed" ? "Composed for you" : "Source"))
            )}
            <span className="block font-medium text-muted-foreground text-xs">
              {sourceNote[r.sourceMode]}
            </span>
          </span>
        </div>
      </main>

      <BottomSlab hint={skip.isError ? planError(skip.error, "unskipping") : undefined}>
        {canEat(planned, today) ? (
          <SlabButton onClick={onAte} data-testid="recipe-ate-it">
            <Check className="size-8" strokeWidth={3} /> Ate it
          </SlabButton>
        ) : status === "planned" ? (
          <SlabButton tone="tint" onClick={onChange} data-testid="recipe-change">
            <CalendarClock className="size-7" strokeWidth={2.5} /> Change day · portions
          </SlabButton>
        ) : status === "skipped" ? (
          <SlabButton
            tone="tint"
            onClick={() => skip.mutate({ id: planned.id, skip: false })}
            disabled={skip.isPending}
            data-testid="unskip"
          >
            <RotateCcw className="size-7" strokeWidth={2.5} /> {skip.isPending ? "Unskipping…" : "Unskip"}
          </SlabButton>
        ) : (
          planned.loggedMealId && (
            <SlabButton tone="tint" onClick={onOpenMeal} data-testid="open-logged">
              Open the logged meal
            </SlabButton>
          )
        )}
      </BottomSlab>
    </>
  );
}

/** A skipped meal says so, and that it counts nowhere; Unskip (the bottom slab) undoes it. */
function SkippedBand({ planned, dayWord }: { planned: PlannedMealView; dayWord: string }) {
  return (
    <Band tone="tint" className="px-5 py-3" role="status" data-testid="skipped-band">
      <Label className="text-muted-foreground">Skipped</Label>
      <p className="mt-0.5 font-medium text-[15px] leading-snug">
        Not counted {dayWord === "today" ? "today" : `on ${dayWord}`}, and its {planned.slot} slot is open
        again. Unskip puts it back.
      </p>
    </Band>
  );
}
