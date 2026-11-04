// Variant A · Request: a planning request is a meal-shaped thing of its own. Plan meals next to
// Log meal; the request screen is the capture view; rounds stack like revisions (input on tint,
// suggestions as plain rows); steering is Add more at the bottom.
import { cn } from "cn";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChefHat,
  Plus,
  Scale,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { BottomSlab, Disclosure, iconButtonClass, Label, SlabButton, Strip } from "@/components/slab";
import {
  DAYS,
  fmt,
  GOAL,
  LEFT_TODAY,
  PLANNED,
  perPortion,
  RECIPES,
  type Recipe,
  ROUNDS,
  SLOT_NAME,
  type Slot,
} from "../mock";
import {
  AddStripMock,
  AteSheet,
  CaptureList,
  ContextBand,
  dayProjection,
  Header,
  InputBand,
  MacroChips,
  MacroGrid,
  MetaLine,
  OverviewMock,
  PlannedRow,
  PlanSheet,
  RecipeScreen,
  RecorderMock,
  SuggestingBand,
  WhyList,
} from "../shared";
import type { Screen } from "../variants";

type Verdict = { kind: "picked"; date: string; slot: Slot } | { kind: "rejected" } | null;

const initialVerdicts: Record<string, Verdict> = {
  curry: { kind: "picked", date: "2026-11-04", slot: "dinner" },
  ofen: { kind: "rejected" },
};

export function PlanA({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const [ate, setAte] = useState(screen === "ate");
  const [planFor, setPlanFor] = useState<Recipe | null>(null);
  const [verdicts, setVerdicts] = useState(initialVerdicts);
  const [open, setOpen] = useState<Recipe | null>(null);
  const todayDinner = PLANNED[0]!;
  const verdict = (r: Recipe) => verdicts[r.id] ?? null;
  const set = (r: Recipe, v: Verdict) => setVerdicts({ ...verdicts, [r.id]: v });

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
          onPlan={(d, s) => {
            set(open, { kind: "picked", date: d, slot: s });
            setPlanFor(null);
            setOpen(null);
          }}
        />
      </>
    );
  }

  if (screen === "overview" || screen === "ate") {
    return (
      <>
        <OverviewA onOpenPlanned={() => go("recipe")} onAte={() => setAte(true)} go={go} />
        <AteSheet
          recipe={RECIPES.get(todayDinner.recipeId)!}
          factor={todayDinner.factor}
          open={ate}
          onClose={() => setAte(false)}
          onLogged={() => setAte(false)}
        />
      </>
    );
  }

  if (screen === "recipe") {
    const r = RECIPES.get(todayDinner.recipeId)!;
    return (
      <>
        <RecipeScreen
          recipe={r}
          planned={todayDinner}
          onBack={() => go("overview")}
          onAte={() => setAte(true)}
          onPlan={() => {}}
        />
        <AteSheet
          recipe={r}
          factor={todayDinner.factor}
          open={ate}
          onClose={() => setAte(false)}
          onLogged={() => {
            setAte(false);
            go("overview");
          }}
        />
      </>
    );
  }

  if (screen === "plan") return <PlanViewA go={go} onOpen={(r) => setOpen(r)} />;

  const planButton = (
    <button type="button" onClick={() => go("plan")} className={iconButtonClass} aria-label="Plan">
      <CalendarCheck className="size-6" strokeWidth={2.5} />
    </button>
  );

  if (screen === "request") {
    return (
      <>
        <Header
          label="Planning request"
          status="draft"
          title="Plan meals"
          onBack={() => go("overview")}
          right={planButton}
        />
        <main className="flex-1">
          <RecorderMock />
          <AddStripMock />
          <CaptureList captures={ROUNDS[0]!.inputs} removable />
          <ContextBand tone="plain" />
        </main>
        <BottomSlab>
          <SlabButton onClick={() => go("suggesting")}>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggest
          </SlabButton>
        </BottomSlab>
      </>
    );
  }

  const suggesting = screen === "suggesting";
  return (
    <>
      <Header
        label="Planning request"
        status={suggesting ? "suggesting" : "suggested"}
        title="Plan meals"
        onBack={() => go("overview")}
        right={planButton}
      />
      <main className="flex-1">
        <OpenSlab />
        {ROUNDS.map((round, i) => {
          const last = i === ROUNDS.length - 1;
          return (
            <section key={round.n} aria-label={`Round ${round.n}`}>
              <InputBand
                captures={round.inputs}
                title={round.n === 1 ? "You asked" : "You added"}
                meta={`Round ${round.n} · ${round.at.replace("Today, ", "")}`}
              />
              {last && suggesting ? (
                <SuggestingBand round={round.n} />
              ) : (
                <ul className="divide-y divide-border">
                  {round.suggestions.map((r) => (
                    <SuggestionRowA
                      key={r.id}
                      r={r}
                      verdict={verdict(r)}
                      onPick={() => setPlanFor(r)}
                      onReject={() => set(r, { kind: "rejected" })}
                      onUndo={() => set(r, null)}
                      onOpen={() => setOpen(r)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {!suggesting && (
          <>
            <Strip title="Steer" meta="adds a round" />
            <RecorderMock tone="tint" line="“Less meat.” “More like the second one, but faster.”" />
            <AddStripMock />
          </>
        )}
      </main>
      <BottomSlab hint={suggesting ? undefined : "Add something above to steer the next round."}>
        <SlabButton tone="tint" disabled>
          <Sparkles className="size-7" strokeWidth={2.5} /> {suggesting ? "Suggesting…" : "Suggest again"}
        </SlabButton>
      </BottomSlab>
      <PlanSheet
        recipe={planFor}
        open={planFor !== null}
        onClose={() => setPlanFor(null)}
        defaultDate="2026-11-05"
        onPlan={(d, s) => {
          if (planFor) set(planFor, { kind: "picked", date: d, slot: s });
          setPlanFor(null);
        }}
      />
    </>
  );
}

/** The request's ink slab: what is open tonight, and that Wed and Thu are whole days. */
function OpenSlab() {
  return (
    <section className="bg-ink px-5 pt-4 pb-5 text-ink-foreground">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="display text-[64px]">{fmt(LEFT_TODAY.energyKcal)}</div>
          <Label className="mt-2 text-ink-muted">kcal open tonight</Label>
        </div>
        <div className="pb-1 text-right">
          <div className="display text-[28px]">Tue–Thu</div>
          <Label className="mt-1 text-ink-muted">3 dinners</Label>
        </div>
      </div>
      <MacroGrid n={LEFT_TODAY} open={null} className="mt-4 border-ink-line border-t pt-3" />
      <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
        Wed and Thu are whole days: {fmt(GOAL.targets.energyKcal)} kcal · {GOAL.targets.protein} g protein
        each
      </Label>
    </section>
  );
}

/** A suggestion as a plain row: title and kcal, pitch, macro chips, why, meta, then Pick / Reject. */
function SuggestionRowA({
  r,
  verdict,
  onPick,
  onReject,
  onUndo,
  onOpen,
}: {
  r: Recipe;
  verdict: Verdict;
  onPick: () => void;
  onReject: () => void;
  onUndo: () => void;
  onOpen: () => void;
}) {
  const n = perPortion(r);
  if (verdict?.kind === "rejected") {
    return (
      <li className="flex min-h-11 items-center gap-3 px-5 text-muted-foreground">
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {r.title} <span className="font-bold text-xs uppercase tracking-[0.08em]">· rejected</span>
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="h-11 px-1 font-bold text-sm underline underline-offset-4"
        >
          Undo
        </button>
      </li>
    );
  }
  const picked = verdict?.kind === "picked";
  const day = picked ? DAYS.find((d) => d.date === verdict.date) : null;
  return (
    <li className="px-5 py-4" data-picked={picked}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-4 text-left">
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1.5 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {day?.label},{" "}
              {SLOT_NAME[verdict.slot].toLowerCase()}
            </Label>
          )}
          <h3 className="display text-[19px] leading-[1.05] tracking-[-0.02em]">{r.title}</h3>
          <p className="mt-1.5 font-medium text-muted-foreground text-sm leading-snug">{r.pitch}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[26px]">{fmt(n.energyKcal)}</div>
          <Label className="text-[10px] text-muted-foreground">kcal / portion</Label>
        </div>
      </button>
      <MacroChips n={n} className="mt-2.5" />
      <WhyList r={r} compact className="mt-3" />
      <MetaLine r={r} className="mt-3" />
      {!picked && (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={onPick}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-foreground font-bold text-background text-sm uppercase tracking-[0.08em] active:opacity-80"
          >
            <Check className="size-5" strokeWidth={3} /> Pick
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex h-11 w-24 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
            aria-label="Reject"
          >
            <X className="size-5" strokeWidth={2.5} /> No
          </button>
        </div>
      )}
    </li>
  );
}

function OverviewA({
  onOpenPlanned,
  onAte,
  go,
}: {
  onOpenPlanned: () => void;
  onAte: () => void;
  go: (s: Screen) => void;
}) {
  return <OverviewMockA go={go} onOpenPlanned={onOpenPlanned} onAte={onAte} />;
}

function OverviewMockA({
  go,
  onOpenPlanned,
  onAte,
}: {
  go: (s: Screen) => void;
  onOpenPlanned: () => void;
  onAte: () => void;
}) {
  // the overview with two slab halves: Log meal (lime) and Plan meals (tint: it doesn't want the user)
  return (
    <OverviewShell
      onOpenPlanned={onOpenPlanned}
      onAte={onAte}
      slab={
        <BottomSlab>
          <div className="flex">
            <SlabButton className="flex-1" onClick={() => {}}>
              <Plus className="size-8" strokeWidth={3} /> Log meal
            </SlabButton>
            <SlabButton tone="tint" className="w-[45%] text-[18px]" onClick={() => go("request")}>
              <ChefHat className="size-7" strokeWidth={2.5} /> Plan meals
            </SlabButton>
          </div>
        </BottomSlab>
      }
    />
  );
}

function OverviewShell(props: { slab: React.ReactNode; onOpenPlanned: () => void; onAte: () => void }) {
  return (
    <OverviewMock
      {...props}
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
    />
  );
}

/** The plan as a list of days: today's projection as the ink slab, then a strip and rows per day. */
function PlanViewA({ go, onOpen }: { go: (s: Screen) => void; onOpen: (r: Recipe) => void }) {
  const today = dayProjection(DAYS[0]!);
  return (
    <>
      <Header label="Plan" title="Next days" onBack={() => go("suggestions")} />
      <main className="flex-1">
        <section className="bg-ink px-5 pt-4 pb-5 text-ink-foreground">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">{fmt(today.total.energyKcal)}</div>
              <Label className="mt-2 text-ink-muted">kcal today with the plan</Label>
            </div>
            <div className="pb-1 text-right">
              <div className={cn("display text-[28px]", today.left.energyKcal >= 0 && "text-lime")}>
                {today.left.energyKcal >= 0 ? fmt(today.left.energyKcal) : `+${fmt(-today.left.energyKcal)}`}
              </div>
              <Label className="mt-1 text-ink-muted">
                {today.left.energyKcal >= 0 ? "left of" : "over"} {fmt(GOAL.targets.energyKcal)}
              </Label>
            </div>
          </div>
          <MacroGrid n={today.total} open={GOAL.targets} className="mt-4 border-ink-line border-t pt-3" />
          <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
            <ChefHat className="size-3.5" strokeWidth={2.5} /> 2 eaten · 1 planned · {today.words?.words}
          </Label>
        </section>
        {DAYS.map((d) => {
          const p = dayProjection(d);
          return (
            <section key={d.date}>
              <Strip
                title={d.label}
                meta={
                  p.list.length
                    ? `${fmt(p.total.energyKcal)} / ${fmt(GOAL.targets.energyKcal)} kcal · ${p.words ? p.words.words.toLowerCase() : "rest open"}`
                    : d.short
                }
              />
              {p.list.length === 0 ? (
                <p className="px-5 py-5 font-medium text-muted-foreground">Nothing planned yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.eaten && (
                    <li className="flex min-h-11 items-center px-5 font-medium text-muted-foreground text-sm">
                      2 meals eaten · {fmt(d.eaten.energyKcal)} kcal
                    </li>
                  )}
                  {p.list.map((pl) => (
                    <PlannedRow
                      key={pl.recipeId}
                      recipe={pl.recipe}
                      slot={pl.slot}
                      factor={pl.factor}
                      kcal={pl.nutrients.energyKcal}
                      today={d.date === "2026-11-04"}
                      onOpen={() => onOpen(pl.recipe)}
                      onAte={() => {}}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <Disclosure title="Earlier requests" meta="2">
          <ul className="divide-y divide-border bg-tint">
            <li className="flex min-h-14 items-center justify-between px-5 font-bold text-sm">
              Pumpkin dinners Tue–Thu <Label className="text-muted-foreground">Today</Label>
            </li>
            <li className="flex min-h-14 items-center justify-between px-5 font-bold text-sm">
              Quick lunches, no cooking <Label className="text-muted-foreground">Sat 31 Oct</Label>
            </li>
          </ul>
        </Disclosure>
      </main>
      <BottomSlab>
        <SlabButton tone="tint" onClick={() => go("request")}>
          <ChefHat className="size-7" strokeWidth={2.5} /> Plan meals
        </SlabButton>
      </BottomSlab>
    </>
  );
}
