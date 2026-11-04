// Variant B · Board: plan first. The week board is the ink slab (four days as bars of planned kcal
// against the target), slots under the selected day; every empty slot starts a request scoped to
// it. Suggestions are full-width bands with the day's bar and what the dish would do to it;
// earlier rounds fold with their steer text.
import { cn } from "cn";
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChefHat,
  ChevronRight,
  Plus,
  Scale,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { BottomSlab, Disclosure, iconButtonClass, Label, SlabButton, Strip } from "@/components/slab";
import {
  DAYS,
  EATEN_TODAY,
  fmt,
  GOAL,
  LEFT_TODAY,
  type PlannedMeal,
  perPortion,
  RECIPES,
  type Recipe,
  ROUNDS,
  SLOT_NAME,
  SLOTS,
} from "../mock";
import {
  AddStripMock,
  AteSheet,
  CaptureList,
  dayProjection,
  FitBar,
  fitWords,
  Header,
  InputBand,
  MacroChips,
  MetaLine,
  OverviewMock,
  PlannedRow,
  RecipeScreen,
  RecorderMock,
  SuggestingBand,
  WhyList,
} from "../shared";
import type { Screen } from "../variants";

/** B's plan: tonight was filled from round 2 (the shakshuka), the curry moved to Wednesday. */
const PLANNED_B: PlannedMeal[] = [
  { recipeId: "shakshuka", date: "2026-11-04", slot: "dinner", factor: 1 },
  { recipeId: "curry", date: "2026-11-05", slot: "dinner", factor: 1 },
  { recipeId: "suppe", date: "2026-11-06", slot: "dinner", factor: 1.5 },
];

export function PlanB({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const [ate, setAte] = useState(screen === "ate");
  const [picked, setPicked] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Recipe | null>(null);
  const tonight = PLANNED_B[0]!;

  if (open) {
    return (
      <RecipeScreen
        recipe={open}
        planned={null}
        list={PLANNED_B}
        onBack={() => setOpen(null)}
        onAte={() => {}}
        onPlan={() => {
          setPicked(open.id);
          setOpen(null);
        }}
      />
    );
  }

  if (screen === "overview" || screen === "ate") {
    return (
      <>
        <OverviewMock
          planned={PLANNED_B}
          onOpenPlanned={() => go("recipe")}
          onAte={() => setAte(true)}
          headerRight={
            <>
              <button type="button" onClick={() => go("plan")} className={iconButtonClass} aria-label="Plan">
                <CalendarRange className="size-6" strokeWidth={2.5} />
              </button>
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
          list={PLANNED_B}
          onBack={() => go("plan")}
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
            go("plan");
          }}
        />
      </>
    );
  }

  if (screen === "plan") return <Board go={go} onOpen={() => go("recipe")} onAte={() => setAte(true)} />;

  if (screen === "request") {
    return (
      <>
        <Header label="Suggest for" title="Tonight · dinner" onBack={() => go("plan")} />
        <main className="flex-1">
          <section className="flex items-end justify-between gap-4 bg-tint px-5 pt-3 pb-4">
            <div>
              <Label className="text-muted-foreground">Open tonight</Label>
              <div className="display mt-1 text-[26px]">
                {fmt(LEFT_TODAY.energyKcal)} <span className="text-muted-foreground text-sm">kcal</span> ·{" "}
                {fmt(LEFT_TODAY.protein)} <span className="text-muted-foreground text-sm">g protein</span>
              </div>
            </div>
            <Label className="text-muted-foreground">after 2 meals</Label>
          </section>
          <RecorderMock line="What you fancy tonight, what's in the fridge." />
          <AddStripMock />
          <CaptureList captures={ROUNDS[0]!.inputs} removable />
          <p className="px-5 py-5 font-medium text-muted-foreground text-sm leading-snug">
            The agent also reads your goal, the last 10 days (chicken 3× this week) and Settings →
            Preferences.
          </p>
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
  const r1 = ROUNDS[0]!;
  const r2 = ROUNDS[1]!;
  const base = GOAL.targets.energyKcal - LEFT_TODAY.energyKcal;
  return (
    <>
      <Header
        label="Suggest for"
        status={suggesting ? "suggesting" : "suggested"}
        title="Tonight · dinner"
        onBack={() => go("plan")}
      />
      <main className="flex-1">
        {/* the slot's day as the ink slab: eaten so far, what's open, the bar every band repeats */}
        <section className="bg-ink px-5 pt-4 pb-5 text-ink-foreground">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">{fmt(LEFT_TODAY.energyKcal)}</div>
              <Label className="mt-2 text-ink-muted">kcal open tonight</Label>
            </div>
            <div className="pb-1 text-right">
              <div className="display text-[28px]">{fmt(base)}</div>
              <Label className="mt-1 text-ink-muted">eaten · 2 meals</Label>
            </div>
          </div>
          <FitBar surface="ink" base={base} addition={0} target={GOAL.targets.energyKcal} className="mt-4" />
          <div className="mt-4 grid grid-cols-4 gap-3 border-ink-line border-t pt-3">
            {(["protein", "fat", "carbohydrate", "fiber"] as const).map((k, i) => (
              <div key={k}>
                <div className="display text-[24px]">
                  {fmt(Math.max(0, LEFT_TODAY[k]))}
                  <span className="ml-0.5 font-bold text-ink-muted text-xs">g</span>
                </div>
                <Label className="mt-1.5 text-ink-muted">{["Prot", "Fat", "Carb", "Fibre"][i]} open</Label>
              </div>
            ))}
          </div>
        </section>

        {/* round 1 folded: its steer text and verdicts, open on tap */}
        <Disclosure title="Round 1" meta="4 suggestions · none picked">
          <div className="bg-tint">
            <InputBand captures={r1.inputs} title="You asked" meta={r1.at.replace("Today, ", "")} />
            <ul className="divide-y divide-border">
              {r1.suggestions.map((r) => (
                <li key={r.id} className="flex min-h-12 items-center gap-3 px-5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-bold">{r.title}</span>
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {fmt(perPortion(r).energyKcal)} kcal
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>

        <Strip
          title={`Round ${r2.n}`}
          meta={suggesting ? "suggesting…" : `${r2.suggestions.length} suggestions`}
        />
        <div className="bg-tint px-5 pb-4">
          <p className="font-medium text-[15px] leading-snug">
            “{r2.inputs[0]!.title}” <span className="text-muted-foreground">· voice memo</span>
          </p>
        </div>
        {suggesting ? (
          <SuggestingBand round={2} />
        ) : (
          <ul className="divide-y divide-border">
            {r2.suggestions.map((r) => (
              <BandB
                key={r.id}
                r={r}
                base={base}
                picked={picked === r.id}
                rejected={rejected.has(r.id)}
                onPick={() => setPicked(r.id)}
                onReject={() => setRejected(new Set([...rejected, r.id]))}
                onUndo={() => {
                  const n = new Set(rejected);
                  n.delete(r.id);
                  setRejected(n);
                }}
                onOpen={() => setOpen(r)}
              />
            ))}
          </ul>
        )}
      </main>
      <BottomSlab
        hint={
          suggesting ? "You can leave: a push arrives when it's done." : "Pick one, or say what to change."
        }
      >
        {suggesting ? (
          <SlabButton tone="tint" disabled>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggesting…
          </SlabButton>
        ) : (
          <SlabButton tone="tint" onClick={() => go("request")}>
            <Sparkles className="size-7" strokeWidth={2.5} /> Steer · add input
          </SlabButton>
        )}
      </BottomSlab>
    </>
  );
}

/** A suggestion as a full-width band: the day's bar with the dish added, and where that lands. */
function BandB({
  r,
  base,
  picked,
  rejected,
  onPick,
  onReject,
  onUndo,
  onOpen,
}: {
  r: Recipe;
  base: number;
  picked: boolean;
  rejected: boolean;
  onPick: () => void;
  onReject: () => void;
  onUndo: () => void;
  onOpen: () => void;
}) {
  const n = perPortion(r);
  const total = base + n.energyKcal;
  if (rejected) {
    return (
      <li className="flex min-h-11 items-center gap-3 px-5 text-muted-foreground">
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{r.title} · rejected</span>
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
  return (
    <li className={cn("px-5 pt-4 pb-4", picked && "bg-tint")}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-4 text-left">
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1.5 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · tonight
            </Label>
          )}
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em]">{r.title}</h3>
          <p className="mt-1.5 font-medium text-muted-foreground text-sm leading-snug">{r.pitch}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[28px]">{fmt(n.energyKcal)}</div>
          <Label className="text-[10px] text-muted-foreground">kcal</Label>
        </div>
      </button>
      <FitBar base={base} addition={n.energyKcal} target={GOAL.targets.energyKcal} className="mt-3" />
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <Label className="text-muted-foreground">Today with it</Label>
        <span className="font-bold text-sm">{fitWords(total, GOAL.targets.energyKcal)}</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <MacroChips n={n} />
        <span className="shrink-0 font-bold text-sm">
          {fmt(n.protein)}{" "}
          <span className="text-muted-foreground">of {fmt(LEFT_TODAY.protein)} g P open</span>
        </span>
      </div>
      <WhyList r={r} compact className="mt-3" />
      <MetaLine r={r} className="mt-3" />
      {!picked && (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={onPick}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-foreground font-bold text-background text-sm uppercase tracking-[0.08em] active:opacity-80"
          >
            <Check className="size-5" strokeWidth={3} /> Pick for tonight
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

/** The week board: four day columns on ink, the selected day's slots under it. */
function Board({ go, onOpen, onAte }: { go: (s: Screen) => void; onOpen: () => void; onAte: () => void }) {
  const [sel, setSel] = useState("2026-11-04");
  const day = DAYS.find((d) => d.date === sel)!;
  const p = dayProjection(day, PLANNED_B);
  const bySlot = new Map(p.list.map((x) => [x.slot, x]));
  const emptySlots = SLOTS.filter((s) => !bySlot.has(s));
  return (
    <>
      <Header label="Plan · Tue 4 – Fri 7 Nov" title="This week" onBack={() => go("overview")} />
      <main className="flex-1">
        <section className="bg-ink px-3 pt-4 pb-4 text-ink-foreground">
          <div className="grid grid-cols-4 gap-1">
            {DAYS.map((d) => {
              const q = dayProjection(d, PLANNED_B);
              const eaten = d.eaten?.energyKcal ?? 0;
              const planned = q.plannedTotal.energyKcal;
              const on = d.date === sel;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSel(d.date)}
                  aria-pressed={on}
                  className={cn(
                    "relative flex h-[108px] flex-col items-start justify-between bg-ink-line/40 p-2 text-left",
                    on && "ring-[3px] ring-ink-foreground ring-inset",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Label
                      className={cn(
                        "text-[11px]",
                        d.date === "2026-11-04" ? "bg-ink-foreground px-1 text-ink" : "text-ink-muted",
                      )}
                    >
                      {d.weekday}
                    </Label>
                    <Label className="text-[11px] text-ink-muted">{d.short.split(" ")[0]}</Label>
                  </span>
                  <span>
                    <span className="display block text-[22px]">
                      {q.list.length || eaten ? fmt(q.total.energyKcal) : "—"}
                    </span>
                    <Label className="mt-0.5 block text-[10px] text-ink-muted">
                      {q.list.length ? `${q.list.length} planned` : eaten ? "eaten" : "open"}
                    </Label>
                  </span>
                  <span className="flex h-1.5 w-full bg-ink-line">
                    <span
                      className="h-full bg-lime"
                      style={{ width: `${Math.min(100, (eaten / GOAL.targets.energyKcal) * 100)}%` }}
                    />
                    <span
                      className="h-full bg-ink-foreground"
                      style={{
                        width: `${Math.min(100 - (eaten / GOAL.targets.energyKcal) * 100, (planned / GOAL.targets.energyKcal) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
          <Label className="mt-3 flex items-center gap-3 px-2 text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 bg-lime" /> eaten
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 bg-ink-foreground" /> planned
            </span>
            <span className="ml-auto">of {fmt(GOAL.targets.energyKcal)} kcal</span>
          </Label>
        </section>

        <Strip
          title={`${day.label}${day.label === "Today" ? "" : ` · ${day.short}`}`}
          meta={
            p.list.length || day.eaten
              ? `${fmt(p.total.energyKcal)} / ${fmt(GOAL.targets.energyKcal)} · ${p.words ? p.words.words.toLowerCase() : "rest open"}`
              : "nothing planned"
          }
        />
        <ul className="divide-y divide-border">
          {day.eaten &&
            EATEN_TODAY.map((m) => (
              <li key={m.title} className="flex min-h-14 items-center gap-4 px-5 py-2">
                <span className="min-w-0 flex-1">
                  <Label className="text-muted-foreground">Eaten · {m.time}</Label>
                  <span className="mt-0.5 block truncate font-bold text-[15px]">{m.title}</span>
                </span>
                <span className="display text-[22px]">{fmt(m.nutrients.energyKcal)}</span>
              </li>
            ))}
          {SLOTS.filter((s) => bySlot.has(s)).map((s) => {
            const x = bySlot.get(s)!;
            return (
              <PlannedRow
                key={s}
                recipe={x.recipe}
                slot={s}
                factor={x.factor}
                kcal={x.nutrients.energyKcal}
                today={day.date === "2026-11-04"}
                onOpen={onOpen}
                onAte={onAte}
              />
            );
          })}
          {emptySlots
            .filter((s) => !(day.eaten && s !== "dinner"))
            .map((s) => (
              <li key={s} className="flex min-h-[68px] items-stretch">
                <span className="flex min-w-0 flex-1 flex-col justify-center px-5 py-3">
                  <Label className="text-muted-foreground">{SLOT_NAME[s]}</Label>
                  <span className="mt-0.5 font-medium text-muted-foreground">Nothing planned</span>
                </span>
                <button
                  type="button"
                  onClick={() => go("request")}
                  className="flex w-28 shrink-0 items-center justify-center gap-1.5 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
                >
                  <Sparkles className="size-4" strokeWidth={2.5} /> Suggest
                </button>
              </li>
            ))}
        </ul>
        <div className="flex min-h-14 items-center justify-between bg-tint px-5 font-bold">
          Open {day.label.toLowerCase() === "today" ? "today" : day.label}
          <Label className="flex items-center gap-1 text-muted-foreground">
            day view <ChevronRight className="size-4" strokeWidth={2.5} />
          </Label>
        </div>
        <p className="px-5 py-5 font-medium text-muted-foreground text-sm leading-snug">
          Projected days read like the calendar: on plan, just off, far off; over or under. A day with only a
          dinner planned is simply still open.
        </p>
      </main>
      <BottomSlab>
        <SlabButton tone="tint" onClick={() => go("request")}>
          <Sparkles className="size-7" strokeWidth={2.5} /> Fill the open slots
        </SlabButton>
      </BottomSlab>
    </>
  );
}
