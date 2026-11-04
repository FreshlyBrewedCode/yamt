// Variant C · Deck: one suggestion at a time, full screen. The title is the page title, the numbers
// are the ink slab against what's open tonight, why-it-fits on tint, key ingredients and the source
// below, Skip | Pick as the bottom slab. The round sums up after the last card, with the steer band.
import { cn } from "cn";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChefHat,
  Clock,
  Plus,
  Scale,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { BottomSlab, Disclosure, iconButtonClass, Label, SlabButton, Strip } from "@/components/slab";
import { DAYS, fmt, GOAL, LEFT_TODAY, PLANNED, perPortion, RECIPES, type Recipe, ROUNDS } from "../mock";
import {
  AddStripMock,
  AteSheet,
  CaptureList,
  ContextBand,
  dayProjection,
  FitBar,
  Header,
  InputBand,
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

const headerIcons = (
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
);

/** Round 1 as the user left it: one picked, the rest skipped. */
const ROUND_1_VERDICTS: Record<string, "picked" | "skipped"> = {
  curry: "picked",
  suppe: "skipped",
  ofen: "skipped",
  gnocchi: "skipped",
};

export function PlanC({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const [ate, setAte] = useState(screen === "ate");
  const [index, setIndex] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, "picked" | "skipped">>({});
  const [planFor, setPlanFor] = useState<Recipe | null>(null);
  const [open, setOpen] = useState<Recipe | null>(null);
  const tonight = PLANNED[0]!;
  const deck = ROUNDS[1]!.suggestions;

  if (open) {
    return (
      <RecipeScreen
        recipe={open}
        planned={null}
        onBack={() => setOpen(null)}
        onAte={() => {}}
        onPlan={() => setPlanFor(open)}
      />
    );
  }

  if (screen === "overview" || screen === "ate") {
    return (
      <>
        <OverviewMock
          onOpenPlanned={() => go("recipe")}
          onAte={() => setAte(true)}
          headerRight={headerIcons}
          afterToday={
            <button
              type="button"
              onClick={() => go("plan")}
              className="flex min-h-14 w-full items-center justify-between bg-tint px-5 text-left font-bold active:opacity-70"
            >
              <span className="flex items-center gap-2">
                <ChefHat className="size-5" strokeWidth={2.5} /> Plan more days
              </span>
              <Label className="flex items-center gap-1 text-muted-foreground">
                Thu, Fri open <ArrowRight className="size-4" strokeWidth={2.5} />
              </Label>
            </button>
          }
          slab={
            <BottomSlab>
              <SlabButton onClick={() => {}}>
                <Plus className="size-8" strokeWidth={3} /> Log meal
              </SlabButton>
            </BottomSlab>
          }
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

  if (screen === "recipe") {
    const r = RECIPES.get(tonight.recipeId)!;
    return (
      <>
        <RecipeScreen
          recipe={r}
          planned={tonight}
          onBack={() => go("overview")}
          onAte={() => setAte(true)}
          onPlan={() => {}}
        />
        <AteSheet
          recipe={r}
          factor={tonight.factor}
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

  if (screen === "plan") return <PlanViewC go={go} onOpen={(r) => setOpen(r)} />;

  if (screen === "request") {
    return (
      <>
        <Header label="Plan" title="What do you fancy?" onBack={() => go("overview")} />
        <main className="flex-1">
          <RecorderMock line="One wish is enough. The agent brings three or four dishes, one at a time." />
          <AddStripMock />
          <CaptureList captures={ROUNDS[0]!.inputs} removable />
          <ContextBand />
        </main>
        <BottomSlab>
          <SlabButton onClick={() => go("suggesting")}>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggest
          </SlabButton>
        </BottomSlab>
      </>
    );
  }

  if (screen === "suggesting") {
    return (
      <>
        <Header label="Plan" status="suggesting" title="Round 2" onBack={() => go("overview")} />
        <main className="flex-1">
          <InputBand
            captures={ROUNDS[1]!.inputs}
            title="You added"
            meta={ROUNDS[1]!.at.replace("Today, ", "")}
          />
          <SuggestingBand round={2} />
          <RoundSummary verdicts={ROUND_1_VERDICTS} round={1} defaultOpen onOpen={(r) => setOpen(r)} />
        </main>
        <BottomSlab hint="You can leave: a push arrives when it's done.">
          <SlabButton tone="tint" disabled>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggesting…
          </SlabButton>
        </BottomSlab>
      </>
    );
  }

  // the deck
  const card = deck[index];
  if (!card) {
    const picked = deck.filter((r) => verdicts[r.id] === "picked");
    return (
      <>
        <Header
          label="Round 2 · done"
          title={picked.length ? `${picked.length} picked` : "Nothing picked"}
          onBack={() => go("overview")}
        />
        <main className="flex-1">
          <RoundSummary verdicts={verdicts} round={2} defaultOpen onOpen={(r) => setOpen(r)} />
          <RoundSummary verdicts={ROUND_1_VERDICTS} round={1} onOpen={(r) => setOpen(r)} />
          <Strip title="Steer" meta="adds a round" />
          <RecorderMock tone="tint" line="“Something lighter.” “The soup, but with chicken.”" />
          <AddStripMock />
          <button
            type="button"
            onClick={() => setIndex(0)}
            className="flex min-h-14 w-full items-center justify-between px-5 font-bold text-sm underline underline-offset-4"
          >
            See the round again
          </button>
        </main>
        <BottomSlab hint="Add something above to steer the next round.">
          <SlabButton tone="tint" disabled>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggest again
          </SlabButton>
        </BottomSlab>
        <PlanSheet
          recipe={planFor}
          open={planFor !== null}
          onClose={() => setPlanFor(null)}
          onPlan={() => setPlanFor(null)}
        />
      </>
    );
  }
  const n = perPortion(card);
  const base = GOAL.targets.energyKcal - LEFT_TODAY.energyKcal;
  const decide = (v: "picked" | "skipped") => {
    setVerdicts({ ...verdicts, [card.id]: v });
    setIndex(index + 1);
  };
  return (
    <>
      <Header
        label={`Round 2 · ${index + 1} of ${deck.length}`}
        title={<span className="block text-[32px] leading-[0.95]">{card.title}</span>}
        onBack={() => (index > 0 ? setIndex(index - 1) : go("overview"))}
      />
      <main className="flex-1">
        <div className="flex gap-1 px-5" aria-hidden>
          {deck.map((r, i) => (
            <span key={r.id} className={cn("h-1.5 flex-1", i <= index ? "bg-foreground" : "bg-tint")} />
          ))}
        </div>
        <p className="px-5 pt-4 pb-4 font-medium text-[15px] text-muted-foreground leading-snug">
          {card.pitch}
        </p>
        <section className="bg-ink px-5 pt-4 pb-5 text-ink-foreground">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">{fmt(n.energyKcal)}</div>
              <Label className="mt-2 text-ink-muted">kcal per portion</Label>
            </div>
            <div className="pb-1 text-right">
              <div className="display text-[28px] text-lime">{fmt(LEFT_TODAY.energyKcal - n.energyKcal)}</div>
              <Label className="mt-1 text-ink-muted">left tonight with it</Label>
            </div>
          </div>
          <FitBar
            surface="ink"
            base={base}
            addition={n.energyKcal}
            target={GOAL.targets.energyKcal}
            className="mt-4"
          />
          <MacroGrid n={n} open={LEFT_TODAY} className="mt-4 border-ink-line border-t pt-3" />
          <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
            <Clock className="size-3.5" strokeWidth={2.5} /> {card.activeMin} min active · {card.totalMin} min
            total
            {card.oven && <span className="ml-auto">Oven</span>}
          </Label>
        </section>
        <section className="bg-tint px-5 pt-4 pb-5">
          <Label className="text-muted-foreground">Why it fits</Label>
          <WhyList r={card} className="mt-2" />
        </section>
        <div className="px-5 pt-4 pb-2">
          <Label className="text-muted-foreground">Key ingredients</Label>
          <div className="mt-2 flex flex-wrap gap-1">
            {card.key.map((k) => (
              <span key={k} className="bg-tint px-2.5 py-1.5 font-bold text-sm">
                {k}
              </span>
            ))}
          </div>
          <MetaLine r={card} className="mt-4" />
        </div>
        <button
          type="button"
          onClick={() => setOpen(card)}
          className="flex min-h-14 w-full items-center justify-between px-5 text-left font-bold active:bg-tint"
        >
          Full recipe
          <Label className="flex items-center gap-1 text-muted-foreground">
            {card.ingredients.length} ingredients · {card.steps.length} steps{" "}
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </Label>
        </button>
      </main>
      <BottomSlab>
        <div className="flex">
          <SlabButton tone="tint" className="w-[38%]" onClick={() => decide("skipped")}>
            <X className="size-7" strokeWidth={2.5} /> Skip
          </SlabButton>
          <SlabButton
            className="flex-1"
            onClick={() => {
              decide("picked");
              setPlanFor(card);
            }}
          >
            <Check className="size-8" strokeWidth={3} /> Pick · tonight
          </SlabButton>
        </div>
      </BottomSlab>
      <PlanSheet
        recipe={planFor}
        open={planFor !== null}
        defaultDate="2026-11-04"
        onClose={() => setPlanFor(null)}
        onPlan={() => setPlanFor(null)}
      />
    </>
  );
}

/** An earlier (or finished) round as a disclosure: title, kcal and the verdict per card. */
function RoundSummary({
  round,
  verdicts,
  defaultOpen = false,
  onOpen,
}: {
  round: 1 | 2;
  verdicts: Record<string, "picked" | "skipped">;
  defaultOpen?: boolean;
  onOpen: (r: Recipe) => void;
}) {
  const r = ROUNDS[round - 1]!;
  const picked = r.suggestions.filter((s) => verdicts[s.id] === "picked").length;
  const seen = r.suggestions.filter((s) => verdicts[s.id]).length;
  return (
    <Disclosure title={`Round ${round}`} meta={`${seen} seen · ${picked} picked`} defaultOpen={defaultOpen}>
      <div className="bg-tint">
        <InputBand
          captures={r.inputs}
          title={round === 1 ? "You asked" : "You added"}
          meta={r.at.replace("Today, ", "")}
        />
        <ul className="divide-y divide-border">
          {r.suggestions.map((s) => {
            const v = verdicts[s.id];
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 px-5 text-left",
                    v === "skipped" && "text-muted-foreground",
                  )}
                >
                  {v === "picked" ? (
                    <Check className="size-4 shrink-0" strokeWidth={3} />
                  ) : v === "skipped" ? (
                    <X className="size-4 shrink-0" strokeWidth={2.5} />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-bold text-sm">{s.title}</span>
                  <Label className="shrink-0 text-muted-foreground">{v ?? "not seen"}</Label>
                  <span className="w-14 shrink-0 text-right font-medium text-sm">
                    {fmt(perPortion(s).energyKcal)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Disclosure>
  );
}

const FADE = {
  on: "bg-lime text-lime-foreground",
  just: "bg-lime/55 text-ink-foreground",
  far: "bg-lime/25 text-ink-foreground dark:bg-lime/35",
} as const;

/** Four days as squares in the calendar's fades, then each day's planned rows. */
function PlanViewC({ go, onOpen }: { go: (s: Screen) => void; onOpen: (r: Recipe) => void }) {
  return (
    <>
      <Header label="Plan" title="Next days" onBack={() => go("overview")} />
      <main className="flex-1">
        <section className="bg-ink px-3 pt-4 pb-4 text-ink-foreground">
          <div className="grid grid-cols-4 gap-1">
            {DAYS.map((d) => {
              const p = dayProjection(d);
              const w = p.words;
              return (
                <div
                  key={d.date}
                  className={cn(
                    "relative flex h-[88px] flex-col justify-between p-2",
                    w
                      ? FADE[w.band]
                      : p.list.length
                        ? "bg-ink-line text-ink-foreground"
                        : "bg-ink-line/40 text-ink-muted",
                  )}
                >
                  {w?.words.endsWith("under") && (
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-ink-foreground" aria-hidden />
                  )}
                  {w?.words.endsWith("over") && (
                    <span className="absolute inset-x-0 top-0 h-1 bg-ink-foreground" aria-hidden />
                  )}
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-[22px] items-center justify-center font-bold text-[13px]",
                        d.date === "2026-11-04" && "bg-ink-foreground text-ink",
                      )}
                    >
                      {d.short.split(" ")[0]}
                    </span>
                    <Label className="text-[11px] opacity-70">{d.weekday}</Label>
                  </span>
                  <span>
                    <span className="display block text-[20px]">
                      {w || p.list.length ? fmt(p.total.energyKcal) : "—"}
                    </span>
                    <Label className="mt-0.5 block text-[10px] opacity-70">
                      {w ? w.words.toLowerCase() : p.list.length ? "rest open" : "nothing planned"}
                    </Label>
                  </span>
                </div>
              );
            })}
          </div>
          <Label className="mt-3 px-2 text-ink-muted">
            Read against the cut once a day is mostly known: on plan from 15 % under to 5 % over
          </Label>
        </section>
        {DAYS.map((d) => {
          const p = dayProjection(d);
          return (
            <section key={d.date}>
              <Strip
                title={d.label}
                meta={
                  p.list.length ? `${p.list.length} planned · ${d.eaten ? "2 eaten" : "rest open"}` : d.short
                }
              />
              {p.list.length === 0 ? (
                <button
                  type="button"
                  onClick={() => go("request")}
                  className="flex min-h-[68px] w-full items-center justify-between px-5 text-left active:bg-tint"
                >
                  <span className="font-medium text-muted-foreground">Nothing planned</span>
                  <Label className="flex items-center gap-1">
                    Plan {d.weekday} <ArrowRight className="size-4" strokeWidth={2.5} />
                  </Label>
                </button>
              ) : (
                <ul className="divide-y divide-border">
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
      </main>
      <BottomSlab>
        <SlabButton onClick={() => go("request")}>
          <Sparkles className="size-7" strokeWidth={2.5} /> Plan Thu and Fri
        </SlabButton>
      </BottomSlab>
    </>
  );
}
