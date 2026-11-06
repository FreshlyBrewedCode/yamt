// Round 3, direction G: the parts the consolidated planning screens are built from. F's starter
// bands and D's docked composer; the nightly suggestions for today; the filter summary and the
// filter page (with the recipe source mode, portions to cook and how many); the request thread
// with an outline that completes one suggestion at a time and a round that partly failed; the
// recipe detail with changes and cook/eat portions; the plan view with leftover portions; the
// shopping list; Settings → Planning. Mock data only, on the D · Slab primitives.
import { cn } from "cn";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  Check,
  ChefHat,
  ChevronRight,
  Clock,
  Globe,
  type LucideIcon,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Utensils,
  X,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Chips, ChoiceList, ChoiceRow } from "@/components/choice";
import { Band, BottomSlab, iconButtonClass, Label, SlabButton, Strip } from "@/components/slab";
import {
  DAYS,
  fmt,
  GOAL,
  LEFT_TODAY,
  type MockCapture,
  type PlannedMeal,
  perPortion,
  projection,
  type Recipe,
  SLOT_NAME,
  type Slot,
  type SourceMode,
  scale,
} from "../mock";
import {
  CONSTRAINT_LABEL,
  DEFAULT_FILTERS,
  FilterGroups,
  type Filters,
  nextOpen,
  pickedMeals,
  REQUEST_FILTERS,
  requestTitle,
  SlotsSlab,
  type Starter,
  TIME_LABEL,
  type Verdict,
  type Verdicts,
  WHEN_LABEL,
} from "../round2/parts";
import {
  captureIcon,
  dayProjection,
  FitBar,
  fitWords,
  Header,
  MacroChips,
  MacroGrid,
  PlannedRow,
  WhyList,
} from "../shared";
import {
  AISLES,
  ALL_RECIPES,
  dayOf,
  G_ROUND_1,
  G_ROUND_2,
  LEFTOVER_PORTIONS,
  LEFTOVERS_G,
  MODE_DETAIL,
  MODE_LABEL,
  MODE_SHORT,
  NIGHTLY,
  NIGHTLY_AT,
  NIGHTLY_REGEN_AT,
  OUTLINE_FAILED,
  OUTLINE_IN_PROGRESS,
  type Outline,
  OWN_LINES,
  PLANNED_G,
  PREFERENCES,
  SETTINGS,
  type ShoppingLine,
  shoppingList,
  slotLabel,
  sourceLabel,
} from "./mock3";

/* ------------------------------------------------------------ overview */

/** The overview's bottom slab: Log (lime) | Plan (tint: it doesn't want the user; the totals slab is the ink). */
export function SplitSlabG({ onLog, onPlan }: { onLog: () => void; onPlan: () => void }) {
  return (
    <BottomSlab>
      <div className="flex">
        <SlabButton className="h-full flex-1 text-[22px]" onClick={onLog}>
          <Plus className="size-8" strokeWidth={3} /> Log
        </SlabButton>
        <SlabButton tone="tint" className="h-full w-[42%] text-[22px]" onClick={onPlan}>
          <ChefHat className="size-7" strokeWidth={2.5} /> Plan
        </SlabButton>
      </div>
    </BottomSlab>
  );
}

/**
 * The Planning strip on the overview: a request with suggestions waiting (lime, like needs-input),
 * one still suggesting (quiet, with how far it is), and tonight's nightly suggestions (quiet: nobody
 * asked for them).
 */
export function PlanningRowsG({ onOpen, onTonight }: { onOpen: () => void; onTonight: () => void }) {
  return (
    <>
      <Strip title="Planning" meta="2 requests · tonight" />
      <ul className="divide-y divide-border">
        <li className="bg-lime text-lime-foreground">
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 text-left active:opacity-80"
          >
            <div className="min-w-0 flex-1">
              <Label className="flex items-center gap-2">
                <Sparkles className="size-3.5" strokeWidth={2.5} /> Suggested · 3 for you
              </Label>
              <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
                Dinners Tue–Thu
              </div>
              <div className="mt-1.5 font-medium text-lime-muted text-xs">
                Pick or steer · round 1 · 15:58
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <ArrowRight className="size-6" strokeWidth={2.5} />
            </div>
          </button>
        </li>
        <li className="flex min-h-[84px] items-stretch gap-4 px-5 py-3 text-muted-foreground">
          <div className="min-w-0 flex-1">
            <Label className="flex items-center gap-2">
              <span className="size-2 animate-pulse bg-current" /> Suggesting · 2 of 3 ready
            </Label>
            <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
              Weekend lunches
            </div>
            <div className="mt-1.5 font-medium text-xs">“Something I can take along” · started 16:04</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="display text-[26px]">2</div>
            <Label className="text-[10px]">of 3</Label>
          </div>
        </li>
        <li>
          <button
            type="button"
            onClick={onTonight}
            className="flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 text-left active:bg-tint"
          >
            <div className="min-w-0 flex-1">
              <Label className="flex items-center gap-2 text-muted-foreground">
                <Moon className="size-3.5" strokeWidth={2.5} /> Tonight · 3 suggestions
              </Label>
              <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
                Omelett, Curry, Gnocchi-Pfanne
              </div>
              <div className="mt-1.5 font-medium text-muted-foreground text-xs">
                Made at {NIGHTLY_AT} for the 82 g protein open
              </div>
            </div>
            <div className="flex shrink-0 items-center text-muted-foreground">
              <ArrowRight className="size-6" strokeWidth={2.5} />
            </div>
          </button>
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------ starters */

/** F's starter as a band: the number big on the left, the prompt and its why on the right. */
export function StarterBand({
  s,
  tone,
  onPick,
}: {
  s: Starter;
  tone: "ink" | "tint" | "plain";
  onPick: (s: Starter) => void;
}) {
  const ink = tone === "ink";
  const muted = ink ? "text-ink-muted" : "text-muted-foreground";
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(s)}
        className={cn(
          "flex w-full items-center gap-4 px-5 text-left active:opacity-80",
          ink ? "bg-ink py-5 text-ink-foreground" : tone === "tint" ? "bg-tint py-4" : "py-4",
        )}
      >
        <span className={cn("shrink-0", ink ? "w-[128px]" : "w-[104px]")}>
          <span className={cn("display block", ink ? "text-[64px]" : "text-[40px]")}>{s.number}</span>
          <Label className={cn("mt-1.5 block text-[10px] leading-tight", muted)}>{s.unit}</Label>
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "display block leading-[1.0] tracking-[-0.03em]",
              ink ? "text-[24px]" : "text-[19px]",
            )}
          >
            {s.text}
          </span>
          <span className={cn("mt-1.5 block font-medium text-xs leading-snug", muted)}>{s.why}</span>
        </span>
        <ArrowRight className="size-5 shrink-0" strokeWidth={2.5} />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------- nightly */

export type NightlyState = "ready" | "regenerating" | "off";

/** A nightly suggestion for tonight: compact, complete (matched, computed), with Pick · tonight. */
function NightlyRow({
  r,
  verdict,
  quiet,
  onOpen,
  onPick,
  onReject,
  onUndo,
}: {
  r: Recipe;
  verdict: Verdict | undefined;
  quiet: boolean;
  onOpen: () => void;
  onPick: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const n = perPortion(r);
  const base = GOAL.targets.energyKcal - LEFT_TODAY.energyKcal;
  if (verdict?.kind === "rejected") {
    return (
      <li className="flex min-h-11 items-center gap-3 px-5 text-muted-foreground">
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{r.title} · no</span>
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
  return (
    <li className={cn("px-5 pt-3 pb-3", picked && "bg-tint", quiet && "text-muted-foreground")}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-4 text-left">
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · tonight
            </Label>
          )}
          <h3 className="display text-[19px] leading-[1.05] tracking-[-0.02em]">{r.title}</h3>
          <p className="mt-1 flex items-start gap-2 font-medium text-muted-foreground text-sm leading-snug">
            <Square className="mt-1.5 size-2 shrink-0 fill-current" strokeWidth={0} />
            {r.why[0]}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[26px]">{fmt(n.energyKcal)}</div>
          <Label className="text-[10px] text-muted-foreground">kcal</Label>
        </div>
      </button>
      <FitBar base={base} addition={n.energyKcal} target={GOAL.targets.energyKcal} className="mt-2.5 h-2" />
      <Label className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" strokeWidth={2.5} /> {r.totalMin} min
        </span>
        <span>·</span>
        <span className="text-foreground">{fmt(n.protein)} of 82 g P</span>
        <span>·</span>
        <span>{sourceLabel(r)}</span>
      </Label>
      {!quiet &&
        (picked ? (
          <button
            type="button"
            onClick={onUndo}
            className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 bg-background font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
          >
            Unplan
          </button>
        ) : (
          <div className="mt-2.5 flex gap-0.5">
            <button
              type="button"
              onClick={onPick}
              className="flex h-11 flex-1 items-center justify-center gap-2 bg-foreground font-bold text-background text-sm uppercase tracking-[0.08em] active:opacity-80"
            >
              <Check className="size-5" strokeWidth={3} /> Pick · tonight
            </button>
            <button
              type="button"
              onClick={onReject}
              className="flex h-11 w-24 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
              aria-label="No"
            >
              <X className="size-5" strokeWidth={2.5} /> No
            </button>
          </div>
        ))}
    </li>
  );
}

/**
 * Tonight's suggestions from the nightly run (made at 03:00, complete like a round's), with
 * Regenerate; while regenerating the three stay, quiet, until the new ones arrive.
 */
export function NightlySection({
  state,
  verdicts,
  setVerdicts,
  onOpen,
  onRegenerate,
}: {
  state: NightlyState;
  verdicts: Verdicts;
  setVerdicts: (v: Verdicts) => void;
  onOpen: (r: Recipe) => void;
  onRegenerate: () => void;
}) {
  if (state === "off") return null;
  const regen = state === "regenerating";
  return (
    <section>
      <Strip
        title="Tonight"
        meta={
          regen ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 animate-pulse bg-current" /> Regenerating
            </span>
          ) : (
            `3 suggestions · made ${NIGHTLY_AT}`
          )
        }
      />
      {regen && (
        <p className="bg-tint px-5 pb-4 font-medium text-[15px] leading-snug">
          Started {NIGHTLY_REGEN_AT}. These three stay until the new ones arrive; a push comes when they do.
        </p>
      )}
      <ul className="divide-y divide-border">
        {NIGHTLY.map((r) => (
          <NightlyRow
            key={r.id}
            r={r}
            verdict={verdicts[r.id]}
            quiet={regen}
            onOpen={() => onOpen(r)}
            onPick={() =>
              setVerdicts({ ...verdicts, [r.id]: { kind: "picked", date: "2026-11-04", slot: "dinner" } })
            }
            onReject={() => setVerdicts({ ...verdicts, [r.id]: { kind: "rejected" } })}
            onUndo={() => setVerdicts({ ...verdicts, [r.id]: undefined })}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regen}
        className="flex min-h-14 w-full items-center gap-3 border-border border-t px-5 text-left outline-none active:bg-tint disabled:text-muted-foreground"
      >
        <RefreshCw className={cn("size-5 shrink-0", regen && "animate-spin")} strokeWidth={2.5} />
        <span className="flex-1 font-bold uppercase tracking-[0.08em]">
          {regen ? "Regenerating…" : "Regenerate"}
        </span>
        <Label className="text-muted-foreground">{regen ? "a few minutes" : "runs now"}</Label>
      </button>
    </section>
  );
}

/* --------------------------------------------------------- the filters */

/** The request's structured part in G: round 2's filters plus the source mode, portions to cook and how many. */
export interface Filters3 extends Filters {
  mode: SourceMode;
  cook: number;
  count: number;
}

export const DEFAULT3: Filters3 = {
  ...DEFAULT_FILTERS,
  mode: SETTINGS.mode,
  cook: SETTINGS.cook,
  count: SETTINGS.perRound,
};

/** The thread's request: Tue–Thu dinners, ≤ 40 min, no oven, the leftovers, adapted recipes, cook 2. */
export const REQUEST3: Filters3 = { ...REQUEST_FILTERS, mode: "adapted", cook: 2, count: 3 };

/** The summary element's words: "Tonight · Dinner · ≤ 40 min · use ½ Hokkaido · cook 2". */
export function summaryWords(f: Filters3): string[] {
  const out: string[] = [];
  out.push(f.when === "days" ? (f.days.length ? f.days.join(", ") : "Pick days") : WHEN_LABEL[f.when]);
  out.push(f.meals.length ? f.meals.map((m) => SLOT_NAME[m]).join(" + ") : "Any meal");
  if (f.time !== "any") out.push(TIME_LABEL[f.time]);
  for (const c of f.constraints) out.push(CONSTRAINT_LABEL[c]);
  if (f.useUp.length) out.push(`use ${f.useUp.join(", ")}`);
  if (f.mode !== SETTINGS.mode) out.push(MODE_SHORT[f.mode].toLowerCase());
  if (f.cook !== 1) out.push(`cook ${f.cook}`);
  return out;
}

/** The request as the agent reads it: the title, time, constraints, leftovers, then the source mode, portions and count. */
export function requestSentence3(f: Filters3): string {
  const parts = [requestTitle(f)];
  if (f.time !== "any") parts.push(`${TIME_LABEL[f.time]} total`);
  for (const c of f.constraints) parts.push(CONSTRAINT_LABEL[c].toLowerCase());
  if (f.useUp.length) parts.push(`using ${f.useUp.join(" and ")}`);
  const mode =
    f.mode === "real" ? "real recipes only" : f.mode === "adapted" ? "real recipes, adapted" : "any recipe";
  return `${parts.join(", ")}. ${f.count} suggestions, ${mode}, ${f.cook === 1 ? "one portion each" : `${f.cook} portions each (eat one, keep the rest)`}.`;
}

/** The one element above the composer that opens the filter page: a 48 px tint row with the summary. */
export function FilterSummary({ filters, onOpen }: { filters: Filters3; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-12 w-full items-center gap-3 bg-tint px-5 text-left active:opacity-70"
      aria-label="Filters"
    >
      <Label className="shrink-0 text-muted-foreground">For</Label>
      <span className="min-w-0 flex-1 truncate font-bold text-sm">{summaryWords(filters).join(" · ")}</span>
      <ChevronRight className="size-5 shrink-0" strokeWidth={2.5} />
    </button>
  );
}

/** The dock: the composer as the sticky footer on the page colour, clear of the home indicator. */
export function Dock({ above, children }: { above?: React.ReactNode; children: React.ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 bg-background">
      {above}
      <div className="pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">{children}</div>
    </footer>
  );
}

const MODES: SourceMode[] = ["real", "adapted", "free"];

/**
 * The filter page: the request as the agent will read it (ink), then every group editable on the
 * page: when, which meals, time, constraints, use up, the recipe source for this request, portions
 * to cook, how many suggestions. Done returns to the entry screen.
 */
export function FilterPage({
  filters,
  onChange,
  onDone,
}: {
  filters: Filters3;
  onChange: (f: Filters3) => void;
  onDone: () => void;
}) {
  return (
    <>
      <Header label="Request" title="Filters" onBack={onDone} />
      <main className="flex-1">
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <Label className="text-ink-muted">How the agent reads it</Label>
          <p className="display mt-2 text-[24px] leading-[1.05] tracking-[-0.03em]">
            {requestSentence3(filters)}
          </p>
          <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
            Plus what you type, say, attach · goal, last 10 days, preferences
          </Label>
        </Band>
        <div className="pt-4 pb-5">
          <FilterGroups filters={filters} onChange={(f) => onChange({ ...filters, ...f })} surface="page" />
        </div>
        <Strip title="Recipes" meta={`default · ${MODE_SHORT[SETTINGS.mode].toLowerCase()}`} />
        <ChoiceList label="Recipe source">
          {MODES.map((m) => (
            <ChoiceRow
              key={m}
              title={MODE_LABEL[m]}
              detail={MODE_DETAIL[m]}
              selected={filters.mode === m}
              onSelect={() => onChange({ ...filters, mode: m })}
            />
          ))}
        </ChoiceList>
        <Strip title="Portions" meta="per recipe" />
        <div className="px-5 pt-4 pb-5">
          <Label className="mb-2 text-muted-foreground">Cook</Label>
          <Chips
            label="Portions to cook"
            options={[1, 2, 3, 4].map((p) => ({
              value: p,
              label: p === 1 ? "portion" : "portions",
              sub: String(p),
            }))}
            value={filters.cook}
            onChange={(cook) => onChange({ ...filters, cook })}
          />
          <p className="mt-2 font-medium text-muted-foreground text-sm">
            {filters.cook === 1
              ? "One portion, nothing left over."
              : `Eat one, ${filters.cook - 1} ${filters.cook === 2 ? "portion becomes a leftover" : "portions become leftovers"} the plan can use.`}
          </p>
          <Label className="mt-5 mb-2 text-muted-foreground">Suggestions per round</Label>
          <Chips
            label="How many"
            options={[2, 3, 4, 5].map((p) => ({
              value: p,
              label: p === SETTINGS.perRound ? "default" : "ideas",
              sub: String(p),
            }))}
            value={filters.count}
            onChange={(count) => onChange({ ...filters, count })}
          />
        </div>
      </main>
      <BottomSlab>
        <SlabButton onClick={onDone}>
          <Check className="size-8" strokeWidth={3} /> Done
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/* ----------------------------------------------------------- the thread */

/** A suggestion's time and source in one micro-label line. */
function SourceLine({ r, className }: { r: Recipe; className?: string }) {
  const Icon: LucideIcon = r.source.kind === "web" ? Globe : r.source.kind === "own" ? Utensils : Sparkles;
  return (
    <Label className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" strokeWidth={2.5} />
        {r.activeMin} min active · {r.totalMin} total
      </span>
      <span>·</span>
      <span className="inline-flex items-center gap-1">
        <Icon className="size-3.5" strokeWidth={2.5} />
        {sourceLabel(r)}
      </span>
    </Label>
  );
}

/**
 * A complete suggestion as a full-width band (B's): title and kcal, the proposed day's bar with the
 * dish added, the protein open, two why lines, the source label; Pick takes the proposed slot
 * ("Pick · Wed dinner"), or the next open one when that is filled; No folds the row.
 */
export function SuggestionBand({
  r,
  verdict,
  verdicts,
  onPick,
  onReject,
  onUndo,
  onOpen,
  onChange,
}: {
  r: Recipe;
  verdict: Verdict | undefined;
  verdicts: Verdicts;
  onPick: (at: { date: string; slot: Slot }) => void;
  onReject: () => void;
  onUndo: () => void;
  onOpen: () => void;
  onChange: () => void;
}) {
  const n = perPortion(r);
  const planned = pickedMeals(verdicts);
  if (verdict?.kind === "rejected") {
    return (
      <li className="flex min-h-11 items-center gap-3 px-5 text-muted-foreground">
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{r.title} · no</span>
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
  const picked = verdict?.kind === "picked" ? verdict : null;
  const taken = new Set(planned.map((p) => `${p.date}/${p.slot}`));
  const proposedFree = r.proposed && !taken.has(`${r.proposed.date}/${r.proposed.slot}`);
  const target = picked ?? (proposedFree ? r.proposed! : nextOpen(verdicts));
  const day = target ? dayOf(target.date)! : DAYS[0]!;
  const others = planned.filter((p) => !(picked && p.recipeId === r.id));
  const base = projection(day, others).total;
  const total = base.energyKcal + n.energyKcal;
  const openP = Math.max(0, GOAL.targets.protein - base.protein);
  return (
    <li className={cn("px-5 pt-4 pb-4", picked && "bg-tint")}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-4 text-left">
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1.5 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {slotLabel(picked)}
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
      <FitBar
        base={base.energyKcal}
        addition={n.energyKcal}
        target={GOAL.targets.energyKcal}
        className="mt-3"
      />
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <Label className="text-muted-foreground">{day.weekday} with it</Label>
        <span className="font-bold text-sm">{fitWords(total, GOAL.targets.energyKcal)}</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <MacroChips n={n} />
        <span className="shrink-0 font-bold text-sm">
          {fmt(n.protein)} <span className="text-muted-foreground">of {fmt(openP)} g P open</span>
        </span>
      </div>
      <WhyList r={{ ...r, why: r.why.slice(0, 2), note: undefined }} compact className="mt-3" />
      <SourceLine r={r} className="mt-3" />
      {picked ? (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={onChange}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-background font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
          >
            <CalendarCheck className="size-5" strokeWidth={2.5} /> Change day · portions
          </button>
          <button
            type="button"
            onClick={onUndo}
            className="flex h-11 w-24 items-center justify-center gap-2 bg-background font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
          >
            Unplan
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={() => target && onPick(target)}
            disabled={!target}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-foreground font-bold text-background text-sm uppercase tracking-[0.08em] active:opacity-80 disabled:bg-tint disabled:text-muted-foreground"
          >
            <Check className="size-5" strokeWidth={3} />{" "}
            {target ? `Pick · ${slotLabel(target)}` : "All slots filled"}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="flex h-11 w-24 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
            aria-label="No"
          >
            <X className="size-5" strokeWidth={2.5} /> No
          </button>
        </div>
      )}
    </li>
  );
}

/** An idea of the outline, before the agent completes it: title, approach, source, proposed slot, its state. Quiet. */
export function OutlineRow({ o }: { o: Outline }) {
  return (
    <li className="px-5 pt-4 pb-4 text-muted-foreground">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em]">{o.title}</h3>
          <p className="mt-1.5 font-medium text-sm leading-snug">{o.approach}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[28px]">—</div>
          <Label className="text-[10px]">kcal</Label>
        </div>
      </div>
      <div className="mt-3 flex h-3 w-full bg-foreground/8" aria-hidden />
      <Label className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          {o.state === "checking" && <span className="size-2 animate-pulse bg-current" />}
          {o.state === "checking" ? "Checking ingredients…" : "Queued"}
        </span>
        <span>·</span>
        <span>{o.source}</span>
        <span className="ml-auto">{slotLabel(o.proposed)}</span>
      </Label>
    </li>
  );
}

/** An idea the agent couldn't complete: quiet, the reason in its words, Try again. Orange only if the whole round failed. */
export function FailedRow({ o }: { o: Outline }) {
  return (
    <li className="px-5 pt-4 pb-4">
      <div className="flex items-start gap-4 text-muted-foreground">
        <div className="min-w-0 flex-1">
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em] line-through decoration-2">
            {o.title}
          </h3>
          <p className="mt-1.5 font-medium text-sm leading-snug">{o.approach}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="display text-[28px]">—</div>
          <Label className="text-[10px]">kcal</Label>
        </div>
      </div>
      <p className="mt-3 flex items-start gap-2 font-medium text-[15px] leading-snug">
        <Square className="mt-1.5 size-2 shrink-0" strokeWidth={3} />
        <span>
          <b className="font-bold">Couldn't complete.</b> {o.reason}
        </span>
      </p>
      <div className="mt-3 flex gap-0.5">
        <button
          type="button"
          className="flex h-11 flex-1 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
        >
          <RefreshCw className="size-5" strokeWidth={2.5} /> Try this one again
        </button>
      </div>
    </li>
  );
}

export type ThreadStage3 = "progress" | "done" | "partial" | "round2";

/** What the user asked: the filter chips and the inputs, on tint. */
function AskedBand3({
  title,
  meta,
  words,
  inputs,
}: {
  title: string;
  meta: string;
  words: string[];
  inputs: MockCapture[];
}) {
  return (
    <Band tone="tint" className="px-5 pt-4 pb-4">
      <div className="flex items-end justify-between">
        <h2 className="display text-[22px]">{title}</h2>
        <Label className="text-muted-foreground">{meta}</Label>
      </div>
      {words.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-0.5">
          {words.map((w) => (
            <span key={w} className="bg-background px-2.5 py-1.5 font-bold text-[13px]">
              {w}
            </span>
          ))}
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {inputs.map((c) => {
          const Icon = captureIcon[c.kind];
          return (
            <li key={c.title} className="flex items-start gap-2.5 font-medium text-[15px] leading-snug">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
              <span>
                {c.kind === "note" || c.kind === "audio" ? `“${c.title}”` : c.title}
                <span className="text-muted-foreground"> · {c.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Band>
  );
}

const ROUND_1_INPUTS3: MockCapture[] = [
  {
    kind: "note",
    title: "Something with pumpkin, I still have half a Hokkaido. Wednesday without the oven.",
    detail: "Text",
  },
  { kind: "photo", title: "Fridge", detail: "Photo · feta, spinach, eggs seen" },
  { kind: "link", title: "chefkoch.de/rezepte/kuerbis-curry", detail: "Link" },
];
const ROUND_2_INPUTS3: MockCapture[] = [
  { kind: "audio", title: "Less meat. More like the second one, but faster.", detail: "Voice · 0:06" },
];

/** The words of the request's chips: round 2's plus the mode and the portions. */
export const requestWords = (f: Filters3) =>
  summaryWords(f).concat(f.mode === SETTINGS.mode ? [MODE_SHORT[f.mode]] : []);

/**
 * The request thread: the slots slab, what you asked, then the rounds. In progress: the outline's
 * placeholders with the first complete suggestion in. Done: the bands, then Suggest more. Partial:
 * two complete, one that couldn't. Round 2: the steer and its round below.
 */
export function ThreadG({
  stage,
  verdicts,
  setVerdicts,
  onBack,
  onPlanView,
  onOpen,
  onChange,
  onSuggestMore,
}: {
  stage: ThreadStage3;
  verdicts: Verdicts;
  setVerdicts: (v: Verdicts) => void;
  onBack: () => void;
  onPlanView: () => void;
  onOpen: (r: Recipe) => void;
  onChange: (r: Recipe) => void;
  onSuggestMore: () => void;
}) {
  const band = (r: Recipe) => (
    <SuggestionBand
      key={r.id}
      r={r}
      verdict={verdicts[r.id]}
      verdicts={verdicts}
      onPick={(at) => setVerdicts({ ...verdicts, [r.id]: { kind: "picked", ...at } })}
      onReject={() => setVerdicts({ ...verdicts, [r.id]: { kind: "rejected" } })}
      onUndo={() => setVerdicts({ ...verdicts, [r.id]: undefined })}
      onOpen={() => onOpen(r)}
      onChange={() => onChange(r)}
    />
  );
  const round1 =
    stage === "partial" ? G_ROUND_1.slice(0, 2) : stage === "progress" ? G_ROUND_1.slice(0, 1) : G_ROUND_1;
  const more = (
    <button
      type="button"
      onClick={onSuggestMore}
      className="flex min-h-16 w-full items-center gap-3 border-border border-t bg-tint px-5 text-left active:opacity-70"
    >
      <Sparkles className="size-5 shrink-0" strokeWidth={2.5} />
      <span className="flex-1 font-bold uppercase tracking-[0.08em]">Suggest more</span>
      <Label className="text-muted-foreground">same request · 3 more</Label>
    </button>
  );
  return (
    <>
      <Header
        label="Request"
        status={stage === "progress" ? "suggesting" : "suggested"}
        title={requestTitle(REQUEST3)}
        onBack={onBack}
        right={
          <button type="button" onClick={onPlanView} className={iconButtonClass} aria-label="Plan view">
            <CalendarCheck className="size-6" strokeWidth={2.5} />
          </button>
        }
      />
      <main className="flex-1">
        <SlotsSlab verdicts={verdicts} note="a pick takes its proposed slot, else the next open one" />
        <AskedBand3
          title="You asked"
          meta="Round 1 · 15:41"
          words={requestWords(REQUEST3)}
          inputs={ROUND_1_INPUTS3}
        />
        <Strip
          title="Round 1"
          meta={
            stage === "progress" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 animate-pulse bg-current" /> 1 of 3 ready
              </span>
            ) : stage === "partial" ? (
              "2 of 3 · 1 couldn't"
            ) : (
              "3 suggestions"
            )
          }
        />
        <ul className="divide-y divide-border">
          {round1.map(band)}
          {stage === "progress" && OUTLINE_IN_PROGRESS.map((o) => <OutlineRow key={o.id} o={o} />)}
          {stage === "partial" && <FailedRow o={OUTLINE_FAILED} />}
        </ul>
        {stage === "progress" ? (
          <p className="border-border border-t px-5 py-4 font-medium text-muted-foreground text-sm leading-snug">
            The agent completes one idea at a time: ingredients matched to real foods, the portion computed,
            its fit to the day. A push arrives when the round is done; anything you add below goes into the
            next one.
          </p>
        ) : stage === "round2" ? (
          <>
            <AskedBand3
              title="You added"
              meta="Round 2 · 16:02"
              words={["Faster"]}
              inputs={ROUND_2_INPUTS3}
            />
            <Strip title="Round 2" meta="3 suggestions" />
            <ul className="divide-y divide-border">{G_ROUND_2.map(band)}</ul>
            {more}
          </>
        ) : (
          more
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------ the recipe */

/**
 * The recipe to cook from (round 1's) plus the source label, the changes against the original for
 * an adapted one, and cook / eat portions: the ink slab is per portion eaten, the ingredients are
 * scaled to the portions cooked, a leftover portion is named.
 */
export function RecipeScreenG({
  recipe,
  planned,
  onBack,
  onAte,
  onPlan,
}: {
  recipe: Recipe;
  planned: PlannedMeal | null;
  onBack: () => void;
  onAte: () => void;
  onPlan: () => void;
}) {
  const [cook, setCook] = useState(planned?.cooked ?? SETTINGS.cook);
  const [eat, setEat] = useState(planned?.factor ?? 1);
  const n = perPortion(recipe);
  const day = planned ? dayOf(planned.date) : null;
  const proj = day ? projection(day, PLANNED_G) : null;
  const dish = scale(n, eat);
  const base = proj
    ? proj.total.energyKcal - n.energyKcal * (planned?.factor ?? 1)
    : GOAL.targets.energyKcal - LEFT_TODAY.energyKcal;
  const open = {
    energyKcal: GOAL.targets.energyKcal - base,
    protein:
      GOAL.targets.protein -
      (proj
        ? proj.total.protein - n.protein * (planned?.factor ?? 1)
        : GOAL.targets.protein - LEFT_TODAY.protein),
    fat:
      GOAL.targets.fat -
      (proj ? proj.total.fat - n.fat * (planned?.factor ?? 1) : GOAL.targets.fat - LEFT_TODAY.fat),
    carbohydrate:
      GOAL.targets.carbohydrate -
      (proj
        ? proj.total.carbohydrate - n.carbohydrate * (planned?.factor ?? 1)
        : GOAL.targets.carbohydrate - LEFT_TODAY.carbohydrate),
    fiber:
      GOAL.targets.fiber -
      (proj ? proj.total.fiber - n.fiber * (planned?.factor ?? 1) : GOAL.targets.fiber - LEFT_TODAY.fiber),
  };
  const today = planned?.date === "2026-11-04";
  const leftover = cook - eat;
  const SourceIcon: LucideIcon =
    recipe.source.kind === "web" ? Globe : recipe.source.kind === "own" ? Utensils : Sparkles;
  return (
    <>
      <Header
        label={
          planned && day
            ? `Planned · ${day.label}, ${SLOT_NAME[planned.slot].toLowerCase()} · cook ${cook}, eat ${eat}`
            : "Suggestion · round 1"
        }
        title={<span className="block text-[32px] leading-[0.95]">{recipe.title}</span>}
        onBack={onBack}
      />
      <main className="flex-1">
        <p className="px-5 pb-2 font-medium text-[15px] text-muted-foreground leading-snug">{recipe.pitch}</p>
        <Label className="flex items-center gap-1.5 px-5 pb-4 text-muted-foreground">
          <SourceIcon className="size-3.5" strokeWidth={2.5} /> {sourceLabel(recipe)}
        </Label>
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">{fmt(dish.energyKcal)}</div>
              <Label className="mt-2 text-ink-muted">
                kcal {eat === 1 ? "per portion" : `for ${eat} portions`}
              </Label>
            </div>
            <div className="pb-1 text-right">
              <div className="display text-[28px] text-lime">{fmt(Math.max(0, open.energyKcal))}</div>
              <Label className="mt-1 text-ink-muted">
                {planned && day ? `open ${day.label === "Today" ? "tonight" : day.weekday}` : "open tonight"}
              </Label>
            </div>
          </div>
          <FitBar
            surface="ink"
            base={base}
            addition={dish.energyKcal}
            target={GOAL.targets.energyKcal}
            className="mt-4"
          />
          <MacroGrid n={dish} open={open} className="mt-4 border-ink-line border-t pt-3" />
          <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
            <Clock className="size-3.5" strokeWidth={2.5} />
            {recipe.activeMin} min active · {recipe.totalMin} min total
            {recipe.oven && <span className="ml-auto">Oven</span>}
          </Label>
        </Band>
        <Band tone="tint" className="px-5 pt-4 pb-5">
          <Label className="text-muted-foreground">Why it fits</Label>
          <WhyList r={recipe} className="mt-2" />
          {recipe.mode === "adapted" && recipe.changes && (
            <>
              <Label className="mt-4 border-border border-t pt-3 text-muted-foreground">
                Changed against {recipe.source.label}
              </Label>
              <ul className="mt-2 space-y-1">
                {recipe.changes.map((c) => (
                  <li key={c} className="flex items-start gap-2 font-medium text-[15px] leading-snug">
                    <Square className="mt-1.5 size-2 shrink-0" strokeWidth={3} />
                    {c}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Band>
        <Strip
          title="Portions"
          meta={
            leftover > 0 ? `${leftover} ${leftover === 1 ? "leftover" : "leftovers"}` : "nothing left over"
          }
        />
        <div className="grid grid-cols-2 gap-5 px-5 pt-4 pb-5">
          <div>
            <Label className="mb-2 text-muted-foreground">Cook</Label>
            <Chips
              label="Portions to cook"
              options={[1, 2, 3, 4].map((p) => ({ value: p, label: "", sub: String(p) }))}
              value={cook}
              onChange={(c) => {
                setCook(c);
                if (eat > c) setEat(c);
              }}
            />
          </div>
          <div>
            <Label className="mb-2 text-muted-foreground">
              Eat {planned && day ? day.label.toLowerCase() : "now"}
            </Label>
            <Chips
              label="Portions to eat"
              options={[0.5, 1, 1.5, 2].map((p) => ({ value: p, label: "", sub: `${p}×` }))}
              value={eat}
              onChange={(e) => {
                setEat(e);
                if (e > cook) setCook(Math.ceil(e));
              }}
            />
          </div>
        </div>
        {leftover > 0 && (
          <p className="flex items-start gap-2.5 px-5 pb-4 font-medium text-[15px] leading-snug">
            <Utensils className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
            <span>
              {leftover} {leftover === 1 ? "portion" : "portions"} ({fmt(n.energyKcal * leftover)} kcal) kept
              as a leftover: the plan offers it{" "}
              {planned
                ? `for ${dayOf(nextDay(planned.date))?.weekday ?? "the next day"} lunch`
                : "the next day"}
              .
            </span>
          </p>
        )}
        <Strip title="Ingredients" meta={`for ${cook} ${cook === 1 ? "portion" : "portions"} cooked`} />
        <ul className="divide-y divide-border">
          {recipe.ingredients.map((i) => (
            <li key={i.name} className="flex min-h-12 items-center gap-3 px-5 py-2">
              <span className="min-w-0 flex-1 truncate font-bold text-[15px]">
                {i.name}
                {i.optional && (
                  <span className="ml-2 font-medium text-muted-foreground text-xs">optional</span>
                )}
              </span>
              <span className="display text-[20px]">
                {fmt((i.grams / recipe.portions) * cook)}
                <span className="font-bold text-muted-foreground text-xs">g</span>
              </span>
            </li>
          ))}
        </ul>
        <Strip title="Steps" meta={`${recipe.steps.length}`} />
        <ol className="divide-y divide-border">
          {recipe.steps.map((s, i) => (
            <li key={s} className="flex items-start gap-4 px-5 py-3">
              <span className="display flex size-8 shrink-0 items-center justify-center bg-tint text-[18px]">
                {i + 1}
              </span>
              <span className="pt-1 font-medium text-[15px] leading-snug">{s}</span>
            </li>
          ))}
        </ol>
        <div className="flex min-h-14 items-center gap-3 bg-tint px-5 py-3">
          <SourceIcon className="size-5 shrink-0" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 font-bold text-sm">
            {recipe.source.kind === "web" ? (
              <span className="underline underline-offset-4">{recipe.source.label}</span>
            ) : (
              recipe.source.label
            )}
            <span className="block font-medium text-muted-foreground text-xs">
              {recipe.source.kind === "web"
                ? recipe.mode === "adapted"
                  ? "Adapted; nutrition computed from the matched ingredients, never from the page"
                  : "As published; nutrition computed from the matched ingredients, never from the page"
                : recipe.source.kind === "own"
                  ? "From your saved recipes"
                  : "Composed from what you have; every ingredient matched to real foods"}
            </span>
          </span>
        </div>
      </main>
      <BottomSlab
        hint={planned && !today ? `Planned for ${day?.label}: Ate it appears on the day.` : undefined}
      >
        {today ? (
          <SlabButton onClick={onAte}>
            <Check className="size-8" strokeWidth={3} /> Ate it
          </SlabButton>
        ) : planned ? (
          <SlabButton tone="tint" onClick={onPlan}>
            <ChefHat className="size-7" strokeWidth={2.5} /> Move or unplan
          </SlabButton>
        ) : (
          <SlabButton onClick={onPlan}>
            <Check className="size-8" strokeWidth={3} /> Plan for…
          </SlabButton>
        )}
      </BottomSlab>
    </>
  );
}

function nextDay(date: string): string {
  const i = DAYS.findIndex((d) => d.date === date);
  return DAYS[i + 1]?.date ?? date;
}

/* ------------------------------------------------------------ plan view */

const FADE = {
  on: "bg-lime text-lime-foreground",
  just: "bg-lime/55 text-ink-foreground",
  far: "bg-lime/25 text-ink-foreground dark:bg-lime/35",
} as const;

/**
 * The plan: C's day squares in the calendar's fades (the ink slab), each day's planned meals and
 * the leftover portion offered on it, the current leftovers, the shopping list's entry.
 */
export function PlanViewG({
  onBack,
  onOpen,
  onShopping,
  onPlanDay,
}: {
  onBack: () => void;
  onOpen: (r: Recipe) => void;
  onShopping: () => void;
  onPlanDay: () => void;
}) {
  const [taken, setTaken] = useState<Set<string>>(new Set());
  return (
    <>
      <Header label="Plan" title="Next days" onBack={onBack} />
      <main className="flex-1">
        <section className="bg-ink px-3 pt-4 pb-4 text-ink-foreground">
          <div className="grid grid-cols-4 gap-1">
            {DAYS.map((d) => {
              const p = dayProjection(d, PLANNED_G);
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
          const p = dayProjection(d, PLANNED_G);
          const offered = LEFTOVER_PORTIONS.filter((l) => l.offeredOn === d.date);
          return (
            <section key={d.date}>
              <Strip
                title={d.label}
                meta={
                  p.list.length
                    ? `${p.list.length} planned${offered.length ? " · 1 leftover" : ""} · ${d.eaten ? "2 eaten" : "rest open"}`
                    : d.short
                }
              />
              <ul className="divide-y divide-border">
                {offered.map((l) => {
                  const r = ALL_RECIPES.get(l.recipeId)!;
                  const kcal = perPortion(r).energyKcal * l.portions;
                  const on = taken.has(`${l.recipeId}/${l.offeredOn}`);
                  return (
                    <li key={l.recipeId} className={cn("flex min-h-[84px] items-stretch", on && "bg-tint")}>
                      <button
                        type="button"
                        onClick={() => onOpen(r)}
                        className="flex min-w-0 flex-1 items-stretch gap-4 px-5 py-3 text-left active:bg-tint"
                      >
                        <div className="min-w-0 flex-1">
                          <Label className="flex items-center gap-2 text-muted-foreground">
                            <Utensils className="size-3.5" strokeWidth={2.5} />
                            {on
                              ? `Planned · ${SLOT_NAME[l.slot]} · leftover`
                              : `Leftover · ${l.portions} portion`}
                          </Label>
                          <div className="display mt-1.5 text-[19px] text-muted-foreground leading-[1.05] tracking-[-0.02em]">
                            {r.title}
                          </div>
                          <div className="mt-1.5 font-medium text-muted-foreground text-xs">
                            Cooked {dayOf(l.cookedOn)?.weekday} ·{" "}
                            {on ? "counts for the day" : `offered for ${SLOT_NAME[l.slot].toLowerCase()}`}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-muted-foreground">
                          <div className="display text-[26px]">{fmt(kcal)}</div>
                          <Label className="text-[10px]">{on ? "planned" : "kcal"}</Label>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(taken);
                          const k = `${l.recipeId}/${l.offeredOn}`;
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          setTaken(next);
                        }}
                        aria-label={
                          on ? "Unplan the leftover" : `Plan it for ${SLOT_NAME[l.slot].toLowerCase()}`
                        }
                        className={cn(
                          "flex w-16 shrink-0 flex-col items-center justify-center gap-1 active:opacity-70",
                          on ? "bg-foreground text-background" : "bg-tint",
                        )}
                      >
                        {on ? (
                          <Check className="size-6" strokeWidth={2.5} />
                        ) : (
                          <Plus className="size-6" strokeWidth={2.5} />
                        )}
                        <Label className="text-[10px]">{on ? "Planned" : "Plan it"}</Label>
                      </button>
                    </li>
                  );
                })}
                {p.list.length === 0 ? (
                  <li>
                    <button
                      type="button"
                      onClick={onPlanDay}
                      className="flex min-h-[68px] w-full items-center justify-between px-5 text-left active:bg-tint"
                    >
                      <span className="font-medium text-muted-foreground">Nothing planned</span>
                      <Label className="flex items-center gap-1">
                        Plan {d.weekday} <ArrowRight className="size-4" strokeWidth={2.5} />
                      </Label>
                    </button>
                  </li>
                ) : (
                  p.list.map((pl) => (
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
                  ))
                )}
              </ul>
            </section>
          );
        })}
        <Strip title="Leftovers" meta="at home now" />
        <ul className="divide-y divide-border">
          {LEFTOVERS_G.map((l) => (
            <li key={l.name} className="flex min-h-14 items-center gap-4 px-5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{l.name}</span>
                <span className="block font-medium text-muted-foreground text-xs">{l.since}</span>
              </span>
              <span className="shrink-0 font-bold text-sm">{l.amount}</span>
            </li>
          ))}
          {LEFTOVER_PORTIONS.map((l) => {
            const r = ALL_RECIPES.get(l.recipeId)!;
            return (
              <li
                key={l.recipeId}
                className="flex min-h-14 items-center gap-4 px-5 py-2 text-muted-foreground"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{r.title}</span>
                  <span className="block font-medium text-xs">
                    After {dayOf(l.cookedOn)?.weekday} · offered {dayOf(l.offeredOn)?.weekday}{" "}
                    {SLOT_NAME[l.slot].toLowerCase()}
                  </span>
                </span>
                <span className="shrink-0 font-bold text-sm">{l.portions} portion</span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onShopping}
          className="flex min-h-16 w-full items-center gap-3 border-border border-t bg-tint px-5 text-left active:opacity-70"
        >
          <Square className="size-5 shrink-0" strokeWidth={2.5} />
          <span className="flex-1 font-bold uppercase tracking-[0.08em]">Shopping list</span>
          <Label className="flex items-center gap-1 text-muted-foreground">
            Tue–Thu ·{" "}
            {shoppingList(PLANNED_G, "2026-11-04", "2026-11-06").filter((l) => l.needed > l.atHome).length} to
            buy <ArrowRight className="size-4" strokeWidth={2.5} />
          </Label>
        </button>
      </main>
      <BottomSlab>
        <SlabButton onClick={onPlanDay}>
          <Sparkles className="size-7" strokeWidth={2.5} /> Plan Friday
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/* --------------------------------------------------------- shopping list */

/**
 * The shopping list for a range of the plan (online only): every ingredient the recipes need,
 * grouped by aisle, what's at home subtracted, check off, a tap shows which recipes need it, add
 * your own line.
 */
export function ShoppingScreen({ onBack }: { onBack: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(["Zwiebel", "Rote Linsen"]));
  const [openLine, setOpenLine] = useState<string | null>("Hokkaido");
  const [adding, setAdding] = useState(false);
  const lines = [...shoppingList(PLANNED_G, "2026-11-04", "2026-11-06"), ...OWN_LINES];
  const toBuy = lines.filter((l) => l.own || l.needed > l.atHome);
  const done = toBuy.filter((l) => checked.has(l.name)).length;
  const toggle = (name: string) => {
    const next = new Set(checked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setChecked(next);
  };
  const row = (l: ShoppingLine) => {
    const on = checked.has(l.name);
    const buy = l.needed - l.atHome;
    const open = openLine === l.name;
    return (
      <li key={l.name} className={cn(open && "bg-tint")}>
        <div className="flex min-h-14 items-stretch">
          <button
            type="button"
            onClick={() => toggle(l.name)}
            aria-pressed={on}
            aria-label={`${on ? "Uncheck" : "Check"} ${l.name}`}
            className="flex w-16 shrink-0 items-center justify-center active:opacity-70"
          >
            <span
              className={cn(
                "flex size-7 items-center justify-center",
                on ? "bg-foreground text-background" : open ? "bg-background" : "bg-tint",
              )}
            >
              {on && <Check className="size-5" strokeWidth={3} />}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOpenLine(open ? null : l.name)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 py-2 pr-5 text-left",
              on && "text-muted-foreground line-through",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-[15px]">{l.name}</span>
              {l.atHomeNote && (
                <span className="block font-medium text-muted-foreground text-xs no-underline">
                  {l.atHomeNote}
                </span>
              )}
              {l.own && <span className="block font-medium text-muted-foreground text-xs">Added by you</span>}
            </span>
            <span className="display shrink-0 text-[20px]">
              {l.own ? "" : fmt(buy)}
              {!l.own && <span className="font-bold text-muted-foreground text-xs">g</span>}
            </span>
          </button>
        </div>
        {open && (
          <ul className="space-y-1 px-5 pb-3 pl-16 font-medium text-sm">
            {l.by.map((b) => (
              <li key={b.title} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{b.title}</span>
                <span className="shrink-0 text-muted-foreground">{fmt(b.grams)} g</span>
              </li>
            ))}
            {l.atHome > 0 && (
              <li className="flex justify-between gap-3 text-muted-foreground">
                <span>At home</span>
                <span>−{fmt(l.atHome)} g</span>
              </li>
            )}
            {l.own && <li className="text-muted-foreground">No recipe needs it: your own line.</li>}
          </ul>
        )}
      </li>
    );
  };
  return (
    <>
      <Header label="Plan · needs yamt online" title="Shopping list" onBack={onBack} />
      <main className="flex-1">
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">
                {done}
                <span className="text-[28px] text-ink-muted"> /{toBuy.length}</span>
              </div>
              <Label className="mt-2 text-ink-muted">in the basket</Label>
            </div>
            <button type="button" className="pb-1 text-right active:opacity-70">
              <div className="display text-[28px]">Tue–Thu</div>
              <Label className="mt-1 flex items-center justify-end gap-1 text-ink-muted">
                3 recipes · change <ChevronRight className="size-3.5" strokeWidth={2.5} />
              </Label>
            </button>
          </div>
          <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
            Amounts for the portions cooked · {lines.filter((l) => l.atHome > 0 && !l.own).length} lines
            already at home
          </Label>
        </Band>
        {AISLES.map((a) => {
          const group = lines.filter((l) => l.aisle === a);
          const buy = group.filter((l) => l.own || l.needed > l.atHome);
          const home = group.filter((l) => !l.own && l.needed <= l.atHome);
          if (!group.length) return null;
          return (
            <section key={a}>
              <Strip title={a} meta={`${buy.filter((l) => checked.has(l.name)).length} of ${buy.length}`} />
              <ul className="divide-y divide-border">{buy.map(row)}</ul>
              {home.length > 0 && (
                <ul className="divide-y divide-border border-border border-t text-muted-foreground">
                  {home.map((l) => (
                    <li
                      key={l.name}
                      className="flex min-h-11 items-center gap-3 px-5 pl-16 font-medium text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="shrink-0 text-xs">{l.atHomeNote ?? "at home"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {adding && (
          <div className="flex items-end gap-0.5 px-5 pt-4 pb-2">
            <div className="min-h-12 min-w-0 flex-1 bg-lime-soft px-4 py-3 font-medium text-base leading-snug">
              Zitronen
              <span
                className="ml-px inline-block h-[1.1em] w-0.5 translate-y-[3px] bg-foreground"
                aria-hidden
              />
            </div>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="flex size-12 shrink-0 items-center justify-center bg-foreground text-background"
              aria-label="Add the line"
            >
              <Check className="size-6" strokeWidth={3} />
            </button>
          </div>
        )}
      </main>
      <BottomSlab>
        <SlabButton tone="tint" onClick={() => setAdding(true)}>
          <Plus className="size-7" strokeWidth={2.5} /> Add a line
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/* ------------------------------------------------------------- settings */

/** The real Settings' square switch. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-8 w-14 shrink-0 items-center p-1", on ? "bg-foreground" : "bg-tint")}
    >
      <span
        className={cn("size-6", on ? "translate-x-6 bg-background" : "translate-x-0 bg-muted-foreground")}
      />
    </span>
  );
}

function SubHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-5 pt-5 pb-2">
      <Label>{title}</Label>
      <Label className="truncate text-muted-foreground">{meta}</Label>
    </div>
  );
}

function SwitchRow({
  title,
  detail,
  on,
  onToggle,
}: {
  title: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-h-16 w-full items-center gap-4 px-5 text-left outline-none focus-visible:bg-tint"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="block font-medium text-muted-foreground text-sm">{detail}</span>
      </span>
      <Switch on={on} />
    </button>
  );
}

/** A 72 px row with a bold title, a muted value and a chevron: opens a sheet (mock). */
function ValueRow({ title, value, meta }: { title: string; value: string; meta?: string }) {
  return (
    <button
      type="button"
      className="flex min-h-[72px] w-full items-center gap-4 px-5 py-3 text-left outline-none focus-visible:bg-tint"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-[17px] leading-tight">{title}</span>
        <span className="mt-0.5 block font-medium text-muted-foreground text-sm leading-snug">{value}</span>
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {meta && <Label>{meta}</Label>}
        <ChevronRight className="size-6" strokeWidth={2.5} />
      </span>
    </button>
  );
}

/**
 * Settings with the new Planning section (in the real screen's style, between Agent and Share):
 * suggestions per round, the default recipe source, the nightly run, portions to cook, the
 * preferences; and in Agent a second line for planning's model and effort.
 */
export function SettingsPlanningScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState(SETTINGS);
  const [planningOwn, setPlanningOwn] = useState(false);
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <button type="button" onClick={onBack} aria-label="Back" className={cn(iconButtonClass, "-ml-1")}>
          <ArrowRight className="size-6 rotate-180" strokeWidth={2.5} />
        </button>
        <h1 className="display mt-4 text-[36px]">Settings</h1>
      </header>
      <main className="flex-1">
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <Label className="flex items-center gap-2 text-ink-muted">
            <Bell className="size-4" strokeWidth={2.5} /> Notifications
          </Label>
          <p className="display mt-2 text-[40px]">On</p>
          <p className="mt-3 font-medium text-ink-muted text-sm">
            This device hears when an analysis or a planning round is done, needs your input or failed.
          </p>
        </Band>

        <section>
          <Strip title="Agent" meta="analysis · planning" />
          <p className="px-5 pt-4 font-medium">
            Which agent analyses your meals and plans them, with which model and how hard it thinks. Planning
            follows the analysis unless set apart.
          </p>
          <SubHead title="Harness" meta="Set here" />
          <ChoiceList label="Harness" className="border-border border-b">
            <ChoiceRow
              title="Claude Code"
              detail="claude-agent-acp 0.9.2 · Anthropic's models, with the server's claude login"
              selected
              onSelect={() => {}}
            />
            <ChoiceRow
              title="OpenCode"
              detail="Any provider OpenCode is logged in to on the server"
              selected={false}
              onSelect={() => {}}
            />
          </ChoiceList>
          <SubHead title="Model" meta="Set here" />
          <ul className="divide-y divide-border border-border border-y">
            <li>
              <ValueRow title="Claude Opus 5.5" value="Meal analysis · most capable" meta="13" />
            </li>
            <li>
              <ValueRow
                title={planningOwn ? "Claude Sonnet 5" : "Same as analysis"}
                value={planningOwn ? "Planning · faster, cheaper per round" : "Planning · Claude Opus 5.5"}
                meta="13"
              />
            </li>
          </ul>
          <SubHead title="Effort" meta="Set here" />
          <div className="px-5">
            <Label className="mb-2 text-muted-foreground">Meal analysis</Label>
            <Chips
              label="Effort"
              options={["low", "medium", "high", "max"].map((e) => ({ value: e, label: e }))}
              value="high"
              onChange={() => {}}
            />
            <Label className="mt-4 mb-2 text-muted-foreground">Planning</Label>
            <Chips
              label="Planning effort"
              options={[
                { value: "same", label: "same" },
                ...["low", "medium", "high", "max"].map((e) => ({ value: e, label: e })),
              ]}
              value={planningOwn ? "medium" : "same"}
              onChange={(v) => setPlanningOwn(v !== "same")}
            />
          </div>
          <button
            type="button"
            className="mt-4 flex min-h-14 w-full items-center gap-3 border-border border-t px-5 text-left outline-none focus-visible:bg-tint"
          >
            <RefreshCw className="size-5 shrink-0" strokeWidth={2.5} />
            <span className="flex-1 font-bold uppercase tracking-[0.08em]">Refresh options</span>
            <Label className="text-muted-foreground">Read 4 min ago</Label>
          </button>
        </section>

        <section>
          <Strip title="Planning" meta="suggestions" />
          <p className="px-5 pt-4 font-medium">
            How the agent suggests meals. Each request can change the recipe source and the portions for
            itself; these are the defaults.
          </p>
          <SubHead title="Suggestions per round" meta="Default 3" />
          <div className="px-5">
            <Chips
              label="Suggestions per round"
              options={[2, 3, 4, 5].map((p) => ({
                value: p,
                label: p === 3 ? "default" : "ideas",
                sub: String(p),
              }))}
              value={s.perRound}
              onChange={(perRound) => setS({ ...s, perRound })}
            />
          </div>
          <SubHead title="Recipe source" meta="Set here" />
          <ChoiceList label="Recipe source" className="border-border border-y">
            {MODES.map((m) => (
              <ChoiceRow
                key={m}
                title={MODE_LABEL[m]}
                detail={MODE_DETAIL[m]}
                selected={s.mode === m}
                onSelect={() => setS({ ...s, mode: m })}
              />
            ))}
          </ChoiceList>
          <SubHead title="Tonight's suggestions" meta="nightly run" />
          <ul className="divide-y divide-border border-border border-y">
            <li>
              <SwitchRow
                title="Suggest for today each night"
                detail="Complete suggestions, from what's open and what's at home"
                on={s.nightly}
                onToggle={() => setS({ ...s, nightly: !s.nightly })}
              />
            </li>
            {s.nightly && (
              <>
                <li>
                  <ValueRow title={s.nightlyAt} value="When it runs · the server's time" />
                </li>
                <li className="px-5 py-4">
                  <Label className="mb-2 text-muted-foreground">How many</Label>
                  <Chips
                    label="Nightly suggestions"
                    options={[1, 2, 3, 4].map((p) => ({
                      value: p,
                      label: p === 1 ? "idea" : "ideas",
                      sub: String(p),
                    }))}
                    value={s.nightlyCount}
                    onChange={(nightlyCount) => setS({ ...s, nightlyCount })}
                  />
                </li>
              </>
            )}
          </ul>
          <SubHead title="Portions to cook" meta="Default 2" />
          <div className="px-5">
            <Chips
              label="Portions to cook"
              options={[1, 2, 3, 4].map((p) => ({
                value: p,
                label: p === 1 ? "portion" : "portions",
                sub: String(p),
              }))}
              value={s.cook}
              onChange={(cook) => setS({ ...s, cook })}
            />
            <p className="mt-2 pb-2 font-medium text-muted-foreground text-sm">
              {s.cook === 1
                ? "One portion per recipe, nothing left over."
                : `Eat one, keep ${s.cook - 1}: leftovers the plan offers on the next day.`}
            </p>
          </div>
          <SubHead title="Preferences" meta="read by every request" />
          <ul className="divide-y divide-border border-border border-y">
            {PREFERENCES.map((p) => (
              <li key={p.key}>
                <ValueRow title={p.title} value={p.value} />
              </li>
            ))}
          </ul>
        </section>

        <section>
          <Strip title="Share from other apps" meta="iOS Shortcut" />
          <p className="px-5 pt-4 pb-5 font-medium text-muted-foreground">Unchanged (#26).</p>
        </section>
      </main>
      <BottomSlab>
        <SlabButton tone="tint">Send test notification</SlabButton>
      </BottomSlab>
    </>
  );
}
