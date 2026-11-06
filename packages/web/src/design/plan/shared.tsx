// Parts shared by the three planning variants: the header, mock capture rows, the mock recorder
// and add strip, the "suggesting…" band, per-portion numbers, the fit bar, the recipe detail,
// the Plan-for and Ate-it sheets, planned rows and the overview with today's planned meal.
// All on the D · Slab primitives; nothing talks to the server.
import { cn } from "cn";
import {
  ArrowLeft,
  BookMarked,
  Camera,
  Check,
  ChefHat,
  ClipboardPaste,
  Clock,
  FileAudio,
  Globe,
  Link2,
  type LucideIcon,
  Mic,
  NotebookPen,
  Play,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { CaptureSheet } from "@/components/add-strip";
import { CheckSquare, type ChipOption, Chips } from "@/components/choice";
import { Band, BottomSlab, Label, SlabButton, Strip } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import {
  DAYS,
  EATEN_TODAY,
  fmt,
  GOAL,
  LEFT_TODAY,
  type MockCapture,
  type Nutrients,
  PLANNED,
  type PlanDay,
  type PlannedMeal,
  perPortion,
  planWords,
  projection,
  type Recipe,
  SLOT_NAME,
  SLOTS,
  type Slot,
  scale,
} from "./mock";

/* ------------------------------------------------------------------ header */

export function Header({
  label,
  title,
  onBack,
  right,
  status,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  onBack?: () => void;
  right?: React.ReactNode;
  /** A quiet status like a meal's: "Suggesting" with a pulsing square. */
  status?: "suggesting" | "suggested" | "draft";
}) {
  return (
    <header className="flex items-start gap-3 px-5 pt-5 pb-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-1 flex size-12 shrink-0 items-center justify-center bg-tint active:opacity-70"
        >
          <ArrowLeft className="size-6" strokeWidth={2.5} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <Label className="flex items-center gap-2 text-muted-foreground">
          {label}
          {status && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                {status === "suggesting" && <span className="size-2 animate-pulse bg-current" />}
                {status === "suggesting" ? "Suggesting" : status === "suggested" ? "Suggested" : "Draft"}
              </span>
            </>
          )}
        </Label>
        <h1 className="display mt-1 text-[36px]">{title}</h1>
      </div>
      {right}
    </header>
  );
}

/* ---------------------------------------------------------------- captures */

export const captureIcon: Record<MockCapture["kind"], LucideIcon> = {
  note: NotebookPen,
  photo: Camera,
  link: Link2,
  audio: Mic,
};

/** A fridge "photo": an inline drawing in the tile, never a real picture. */
export function FridgeTile({ className = "size-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn(className, "bg-tint")} aria-hidden>
      <rect x="10" y="6" width="28" height="36" className="fill-foreground/15" />
      <rect x="12" y="8" width="24" height="14" className="fill-background" />
      <rect x="12" y="24" width="24" height="16" className="fill-background" />
      <rect x="14" y="14" width="8" height="6" className="fill-foreground/40" />
      <rect x="24" y="12" width="10" height="8" className="fill-lime" />
      <rect x="14" y="30" width="6" height="8" className="fill-foreground/60" />
      <rect x="22" y="33" width="12" height="5" className="fill-foreground/25" />
    </svg>
  );
}

export function CaptureRow({
  c,
  onRemove,
  quiet = false,
}: {
  c: MockCapture;
  onRemove?: boolean;
  quiet?: boolean;
}) {
  const Icon = captureIcon[c.kind];
  return (
    <li className={cn("flex min-h-[68px] items-center gap-4 px-5 py-3", quiet && "text-muted-foreground")}>
      {c.kind === "photo" ? (
        <FridgeTile />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center bg-tint">
          {c.kind === "audio" ? (
            <Play className="size-6" strokeWidth={2.5} />
          ) : (
            <Icon className="size-6" strokeWidth={2.5} />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-bold leading-snug",
            c.kind === "note" || c.kind === "audio" ? "line-clamp-3" : "truncate",
          )}
        >
          {c.kind === "note" || c.kind === "audio" ? `“${c.title}”` : c.title}
        </span>
        <Label className="mt-0.5 block truncate text-muted-foreground">{c.detail}</Label>
      </span>
      {onRemove && (
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center text-muted-foreground"
          aria-label="Remove"
        >
          <X className="size-5" strokeWidth={2.5} />
        </button>
      )}
    </li>
  );
}

export function CaptureList({
  captures,
  removable = false,
}: {
  captures: MockCapture[];
  removable?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {captures.map((c) => (
        <CaptureRow key={c.title} c={c} onRemove={removable} />
      ))}
    </ul>
  );
}

/** What the user said, compact, on tint: the input band of a round. */
export function InputBand({
  captures,
  title,
  meta,
}: {
  captures: MockCapture[];
  title: string;
  meta: string;
}) {
  return (
    <Band tone="tint" className="px-5 pt-4 pb-4">
      <div className="flex items-end justify-between">
        <h2 className="display text-[22px]">{title}</h2>
        <Label className="text-muted-foreground">{meta}</Label>
      </div>
      <ul className="mt-3 space-y-2">
        {captures.map((c) => {
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

/* ------------------------------------------------------- recorder & strip */

export function RecorderMock({ tone = "ink", line }: { tone?: "ink" | "tint"; line?: string }) {
  const muted = tone === "ink" ? "text-ink-muted" : "text-muted-foreground";
  return (
    <Band tone={tone} className="px-5 pt-5 pb-5" aria-label="Voice memo">
      <div className="flex items-center gap-5">
        <span className="flex size-24 shrink-0 items-center justify-center rounded-full bg-lime text-lime-foreground">
          <Mic className="size-11" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <Label className={muted}>Voice memo</Label>
          <div className="display mt-1 text-[26px]">Tap, talk, done.</div>
          <p className={cn("mt-1.5 font-medium text-sm", muted)}>
            {line ?? "What you fancy, what's left in the fridge, which days."}
          </p>
        </div>
      </div>
    </Band>
  );
}

const STRIP: [string, LucideIcon][] = [
  ["Photo", Camera],
  ["Note", NotebookPen],
  ["Link", Link2],
  ["Audio", FileAudio],
  ["Paste", ClipboardPaste],
];

export function AddStripMock() {
  return (
    <div className="grid grid-cols-5 divide-x divide-border border-border border-b">
      {STRIP.map(([name, Icon]) => (
        <button
          key={name}
          type="button"
          className="flex h-[68px] flex-col items-center justify-center gap-1.5 active:bg-lime active:text-lime-foreground"
        >
          <Icon className="size-6" strokeWidth={2.5} />
          <Label className="text-[11px]">{name}</Label>
        </button>
      ))}
    </div>
  );
}

/** While the agent works: a quiet tint band, like "Analysing". */
export function SuggestingBand({ round }: { round: number }) {
  return (
    <Band tone="tint" className="px-5 pt-4 pb-5" role="status">
      <Label className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2.5 animate-pulse bg-current" /> Suggesting · round {round}
      </Label>
      <p className="mt-2 font-medium text-[15px] leading-snug">
        Reading your input, the goal, the last 10 days and the leftovers, then searching recipes. Usually a
        few minutes. A push arrives when it's done, you can leave.
      </p>
    </Band>
  );
}

/** What the agent takes into account, in one quiet band (preferences: one line, out of scope). */
export function ContextBand({ tone = "tint" }: { tone?: "tint" | "plain" }) {
  return (
    <Band tone={tone} className="px-5 pt-4 pb-5">
      <Label className="text-muted-foreground">Taken into account</Label>
      <ul className="mt-2 space-y-1.5 font-medium text-[15px] leading-snug">
        <li className="flex gap-2.5">
          <Square className="mt-1 size-2.5 shrink-0 fill-current" strokeWidth={0} />
          {GOAL.label}: {fmt(GOAL.targets.energyKcal)} kcal, {GOAL.targets.protein} g protein a day
        </li>
        <li className="flex gap-2.5">
          <Square className="mt-1 size-2.5 shrink-0 fill-current" strokeWidth={0} />
          The last 10 days of meals, for variety (chicken 3× this week)
        </li>
        <li className="flex gap-2.5">
          <Square className="mt-1 size-2.5 shrink-0 fill-current" strokeWidth={0} />
          Leftovers you mention or show
        </li>
        <li className="flex gap-2.5 text-muted-foreground">
          <Square className="mt-1 size-2.5 shrink-0 fill-current" strokeWidth={0} />
          Dislikes, cooking time and equipment from Settings → Preferences
        </li>
      </ul>
    </Band>
  );
}

/* --------------------------------------------------------------- numbers */

const MACROS: [keyof Nutrients, string, string][] = [
  ["protein", "P", "Prot"],
  ["fat", "F", "Fat"],
  ["carbohydrate", "C", "Carb"],
  ["fiber", "Fi", "Fibre"],
];

/** "26 P · 22 F · 78 C · 12 Fi" as small chips (tint) or plain text. */
export function MacroChips({
  n,
  className,
  plain = false,
}: {
  n: Nutrients;
  className?: string;
  plain?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {MACROS.map(([k, short]) => (
        <span
          key={k}
          className={cn(
            "inline-flex items-baseline gap-0.5 font-bold text-[13px]",
            !plain && "bg-tint px-1.5 py-0.5",
          )}
        >
          {fmt(n[k])}
          <span className="text-[10px] text-muted-foreground uppercase">g {short}</span>
        </span>
      ))}
    </div>
  );
}

/** The per-portion grid against what is open: on ink or on the page. */
export function MacroGrid({
  n,
  open,
  surface = "ink",
  className,
}: {
  n: Nutrients;
  /** What is still open of the day the dish is planned for; null = no comparison. */
  open: Nutrients | null;
  surface?: "ink" | "page";
  className?: string;
}) {
  const muted = surface === "ink" ? "text-ink-muted" : "text-muted-foreground";
  const track = surface === "ink" ? "bg-ink-line" : "bg-foreground/15";
  const fill = surface === "ink" ? "bg-lime" : "bg-foreground";
  return (
    <div className={cn("grid grid-cols-4 gap-3", className)}>
      {MACROS.map(([k, , long]) => {
        const v = n[k];
        const o = open?.[k] ?? null;
        return (
          <div key={k}>
            <div className="flex items-baseline gap-0.5">
              <span className="display text-[24px]">{fmt(v)}</span>
              <span className={cn("font-bold text-xs", muted)}>
                {o !== null ? `/${fmt(Math.max(o, 0))}` : "g"}
              </span>
            </div>
            {o !== null && (
              <div className={cn("mt-1.5 flex h-1.5", track)}>
                <div
                  className={cn("h-full", fill)}
                  style={{ width: `${Math.min(100, (v / Math.max(o, 1)) * 100)}%` }}
                />
              </div>
            )}
            <Label className={cn("mt-1.5", muted)}>{long}</Label>
          </div>
        );
      })}
    </div>
  );
}

/**
 * How a dish sits against a day: lime = already eaten or planned, the foreground = this dish,
 * a 2 px gap where the target is, anything past it in the same foreground after the gap.
 */
export function FitBar({
  base,
  addition,
  target,
  surface = "page",
  className,
}: {
  base: number;
  addition: number;
  target: number;
  surface?: "ink" | "page";
  className?: string;
}) {
  const total = base + addition;
  const scaleTo = Math.max(total, target);
  const pct = (x: number) => `${(x / scaleTo) * 100}%`;
  const under = Math.min(total, target);
  const baseW = Math.min(base, target);
  const addW = Math.max(0, under - baseW);
  const over = Math.max(0, total - target);
  return (
    <div
      className={cn("flex h-3 w-full", surface === "ink" ? "bg-ink-line" : "bg-foreground/12", className)}
      role="img"
      aria-label={`${fmt(total)} of ${fmt(target)} kcal with this dish`}
    >
      <div className="h-full bg-lime" style={{ width: pct(baseW) }} />
      <div
        className={cn("h-full", surface === "ink" ? "bg-ink-foreground" : "bg-foreground")}
        style={{ width: pct(addW) }}
      />
      {over > 0 && (
        <>
          <div className={cn("h-full w-0.5 shrink-0", surface === "ink" ? "bg-ink" : "bg-background")} />
          <div
            className={cn("h-full", surface === "ink" ? "bg-ink-foreground/60" : "bg-foreground/50")}
            style={{ width: pct(over) }}
          />
        </>
      )}
    </div>
  );
}

/** "→ 1,740 of 2,200 · 460 left" / "→ 2,310 of 2,200 · 110 over", never red. */
export function fitWords(total: number, target: number): string {
  const d = Math.round(target - total);
  return `${fmt(total)} of ${fmt(target)} · ${d < 0 ? `${fmt(-d)} over` : `${fmt(d)} left`}`;
}

/** Why it fits: filled squares; the agent's caution with a hollow one (nothing failed: no orange). */
export function WhyList({
  r,
  className,
  compact = false,
}: {
  r: Recipe;
  className?: string;
  compact?: boolean;
}) {
  return (
    <ul className={cn("space-y-1", className)}>
      {r.why.map((w) => (
        <li
          key={w}
          className={cn(
            "flex items-start gap-2 font-medium leading-snug",
            compact ? "text-sm" : "text-[15px]",
          )}
        >
          <Square className="mt-1.5 size-2 shrink-0 fill-current" strokeWidth={0} />
          {w}
        </li>
      ))}
      {r.note && (
        <li
          className={cn(
            "flex items-start gap-2 font-medium leading-snug",
            compact ? "text-sm" : "text-[15px]",
          )}
        >
          <Square className="mt-1.5 size-2 shrink-0" strokeWidth={3} />
          {r.note}
        </li>
      )}
    </ul>
  );
}

const sourceIcon: Record<Recipe["source"]["kind"], LucideIcon> = {
  web: Globe,
  own: BookMarked,
  agent: Sparkles,
};

/** "20 min active · 35 total · chefkoch.de" as a micro-label line. */
export function MetaLine({ r, className }: { r: Recipe; className?: string }) {
  const Icon = sourceIcon[r.source.kind];
  return (
    <Label className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" strokeWidth={2.5} />
        {r.activeMin} min active · {r.totalMin} total
      </span>
      <span>·</span>
      <span className="inline-flex items-center gap-1">
        <Icon className="size-3.5" strokeWidth={2.5} />
        {r.source.label}
      </span>
    </Label>
  );
}

/* ---------------------------------------------------------------- sheets */

const DAY_CHIPS: ChipOption<string>[] = DAYS.map((d) => ({
  value: d.date,
  label: d.weekday,
  sub: d.short.split(" ")[0],
}));
const SLOT_CHIPS: ChipOption<Slot>[] = SLOTS.map((s) => ({ value: s, label: SLOT_NAME[s] }));
const PORTION_CHIPS: ChipOption<number>[] = [
  { value: 0.5, label: "Half", sub: "0.5×" },
  { value: 1, label: "One", sub: "1×" },
  { value: 1.5, label: "More", sub: "1.5×" },
  { value: 2, label: "Two", sub: "2×" },
];

/** "Plan for …": day, slot and portion, then the lime action. The day row shows each day's projected kcal. */
export function PlanSheet({
  recipe,
  open,
  onClose,
  onPlan,
  defaultDate = "2026-11-05",
  planned = PLANNED,
  cook: withCook = false,
}: {
  recipe: Recipe | null;
  open: boolean;
  onClose: () => void;
  onPlan: (date: string, slot: Slot, factor: number) => void;
  defaultDate?: string;
  planned?: readonly PlannedMeal[];
  /** Round 3: portions to cook next to the portion eaten. */
  cook?: boolean;
}) {
  const [date, setDate] = useState(defaultDate);
  const [slot, setSlot] = useState<Slot>("dinner");
  const [factor, setFactor] = useState(1);
  const [cook, setCook] = useState(2);
  const day = DAYS.find((d) => d.date === date) ?? DAYS[0]!;
  const proj = projection(day, planned);
  const dish = recipe ? scale(perPortion(recipe), factor) : null;
  const total = proj.total.energyKcal + (dish?.energyKcal ?? 0);
  return (
    <CaptureSheet open={open} onClose={onClose} title={recipe?.title ?? ""} description="Plan for">
      {recipe && (
        <div>
          <div className="px-5 pb-4">
            <Label className="mb-2 text-muted-foreground">Day</Label>
            <Chips label="Day" options={DAY_CHIPS} value={date} onChange={setDate} />
            <Label className="mt-4 mb-2 text-muted-foreground">Slot</Label>
            <Chips label="Slot" options={SLOT_CHIPS} value={slot} onChange={setSlot} />
            {withCook ? (
              <div className="mt-4 grid grid-cols-2 gap-5">
                <div>
                  <Label className="mb-2 text-muted-foreground">Cook</Label>
                  <Chips
                    label="Portions to cook"
                    options={[1, 2, 3, 4].map((p) => ({ value: p, label: "", sub: String(p) }))}
                    value={cook}
                    onChange={setCook}
                  />
                </div>
                <div>
                  <Label className="mb-2 text-muted-foreground">Eat</Label>
                  <Chips
                    label="Portion"
                    options={PORTION_CHIPS.map((p) => ({ value: p.value, label: "", sub: p.sub }))}
                    value={factor}
                    onChange={setFactor}
                  />
                </div>
              </div>
            ) : (
              <>
                <Label className="mt-4 mb-2 text-muted-foreground">Portion</Label>
                <Chips label="Portion" options={PORTION_CHIPS} value={factor} onChange={setFactor} />
              </>
            )}
            {withCook && cook - factor > 0 && (
              <p className="mt-2 font-medium text-muted-foreground text-sm">
                {cook - factor} {cook - factor === 1 ? "portion" : "portions"} left over for the next day.
              </p>
            )}
            <div className="mt-4">
              <FitBar
                base={proj.total.energyKcal}
                addition={dish?.energyKcal ?? 0}
                target={GOAL.targets.energyKcal}
              />
              <div className="mt-2 flex items-baseline justify-between">
                <Label className="text-muted-foreground">{day.label} with it</Label>
                <span className="font-bold text-sm">{fitWords(total, GOAL.targets.energyKcal)}</span>
              </div>
            </div>
          </div>
          <SlabButton onClick={() => onPlan(date, slot, factor)}>
            <Check className="size-7" strokeWidth={2.5} /> Plan · {day.weekday}{" "}
            {SLOT_NAME[slot].toLowerCase()}
          </SlabButton>
        </div>
      )}
    </CaptureSheet>
  );
}

const ATE_PORTIONS: ChipOption<number>[] = [
  { value: 0.5, label: "Half", sub: "0.5×" },
  { value: 1, label: "As planned", sub: "1×" },
  { value: 1.5, label: "More", sub: "1.5×" },
  { value: 2, label: "Double", sub: "2×" },
];

/**
 * "Ate it": the planned meal becomes a logged meal with one tap. Ingredients can be switched off
 * ("minus the feta"), the portion changed; the kcal follow (computed here, like a copy: no analysis).
 */
export function AteSheet({
  recipe,
  factor: planned,
  cooked,
  open,
  onClose,
  onLogged,
}: {
  recipe: Recipe | null;
  factor: number;
  /** Round 3: portions cooked; what isn't eaten stays a leftover. */
  cooked?: number;
  open: boolean;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [without, setWithout] = useState<Set<string>>(new Set());
  const [factor, setFactor] = useState(1);
  const toggle = (name: string) => {
    const next = new Set(without);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setWithout(next);
  };
  const n = recipe ? scale(perPortion(recipe, without), planned * factor) : null;
  return (
    <CaptureSheet
      open={open}
      onClose={onClose}
      title={recipe?.title ?? ""}
      description="Ate it · Today, dinner"
    >
      {recipe && n && (
        <div>
          <p className="px-5 pb-3 font-medium text-muted-foreground text-sm">
            Logged as a meal with these items, scaled to the portion: no analysis. Switch off what you left
            out.
          </p>
          <ul className="divide-y divide-border border-border border-y">
            {recipe.ingredients.map((i) => {
              const on = !without.has(i.name);
              return (
                <li key={i.name}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(i.name)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 px-5 py-2 text-left",
                      !on && "text-muted-foreground line-through",
                    )}
                  >
                    <CheckSquare on={on} />
                    <span className="min-w-0 flex-1 truncate font-bold text-[15px]">{i.name}</span>
                    <span className="display text-[18px]">
                      {fmt((i.grams / recipe.portions) * planned * factor)}
                      <span className="font-bold text-muted-foreground text-xs">g</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-5 pt-4 pb-4">
            <Label className="mb-2 text-muted-foreground">
              Portion{cooked !== undefined && cooked > 1 ? ` · of ${cooked} cooked` : ""}
            </Label>
            <Chips label="Portion" options={ATE_PORTIONS} value={factor} onChange={setFactor} />
            {cooked !== undefined && cooked - planned * factor > 0 && (
              <p className="mt-2 font-medium text-muted-foreground text-sm">
                {cooked - planned * factor}{" "}
                {cooked - planned * factor === 1 ? "portion stays" : "portions stay"} a leftover: the plan
                offers it tomorrow.
              </p>
            )}
            <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-bold text-sm">
                <Clock className="size-4" strokeWidth={2.5} /> Now · change time
              </span>
              <span className="text-right">
                <span className="display text-[28px]">{fmt(n.energyKcal)}</span>
                <Label className="text-[10px] text-muted-foreground">kcal</Label>
              </span>
            </div>
            <MacroChips n={n} plain className="mt-1" />
          </div>
          <SlabButton onClick={onLogged}>
            <Check className="size-7" strokeWidth={2.5} /> Log it
          </SlabButton>
        </div>
      )}
    </CaptureSheet>
  );
}

/* ---------------------------------------------------------- recipe detail */

/**
 * The recipe to cook from: title and pitch, the numbers per portion as the ink slab (against what
 * is open on its day), why it fits on tint, ingredients scaled to the portions, steps, the source.
 * The bottom slab: Ate it (planned for today) or Plan for….
 */
export function RecipeScreen({
  recipe,
  planned,
  onBack,
  onAte,
  onPlan,
  portionsDefault,
  list = PLANNED,
}: {
  recipe: Recipe;
  /** Where it's planned; null for a suggestion. */
  planned: { date: string; slot: Slot; factor: number } | null;
  onBack: () => void;
  onAte: () => void;
  onPlan: () => void;
  portionsDefault?: number;
  list?: readonly PlannedMeal[];
}) {
  const [portions, setPortions] = useState(portionsDefault ?? recipe.portions);
  const day = planned ? DAYS.find((d) => d.date === planned.date) : null;
  const n = perPortion(recipe);
  const proj = day ? projection(day, list) : null;
  const open = planned && proj ? add0(GOAL.targets, proj.total, n, planned.factor) : LEFT_TODAY;
  const today = planned?.date === "2026-11-04";
  const SourceIcon = sourceIcon[recipe.source.kind];
  return (
    <>
      <Header
        label={
          planned && day
            ? `Planned · ${day.label}, ${SLOT_NAME[planned.slot].toLowerCase()}${planned.factor !== 1 ? ` · ${planned.factor}×` : ""}`
            : "Suggestion · round 1"
        }
        title={<span className="block text-[32px] leading-[0.95]">{recipe.title}</span>}
        onBack={onBack}
      />
      <main className="flex-1">
        <p className="px-5 pb-4 font-medium text-[15px] text-muted-foreground leading-snug">{recipe.pitch}</p>
        <Band tone="ink" className="px-5 pt-4 pb-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="display text-[64px]">{fmt(n.energyKcal)}</div>
              <Label className="mt-2 text-ink-muted">kcal per portion</Label>
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
            base={
              proj
                ? proj.total.energyKcal - (planned ? n.energyKcal * planned.factor : 0)
                : GOAL.targets.energyKcal - LEFT_TODAY.energyKcal
            }
            addition={n.energyKcal * (planned?.factor ?? 1)}
            target={GOAL.targets.energyKcal}
            className="mt-4"
          />
          <MacroGrid n={n} open={open} className="mt-4 border-ink-line border-t pt-3" />
          <Label className="mt-4 flex items-center gap-2 border-ink-line border-t pt-3 text-ink-muted">
            <Clock className="size-3.5" strokeWidth={2.5} />
            {recipe.activeMin} min active · {recipe.totalMin} min total
            {recipe.oven && <span className="ml-auto">Oven</span>}
          </Label>
        </Band>
        <Band tone="tint" className="px-5 pt-4 pb-5">
          <Label className="text-muted-foreground">Why it fits</Label>
          <WhyList r={recipe} className="mt-2" />
        </Band>
        <Strip title="Ingredients" meta={`for ${portions} ${portions === 1 ? "portion" : "portions"}`} />
        <div className="px-5 pt-3 pb-1">
          <Chips
            label="Portions"
            options={[1, 2, 3, 4].map((p) => ({
              value: p,
              label: p === 1 ? "portion" : "portions",
              sub: String(p),
            }))}
            value={portions}
            onChange={setPortions}
          />
        </div>
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
                {fmt((i.grams / recipe.portions) * portions)}
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
                ? "Nutrition computed from the ingredients, not from the page"
                : recipe.source.kind === "own"
                  ? "From your saved recipes"
                  : "The agent composed it from what you have"}
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

/** target − (day's projected total without this dish): what is open for it. */
function add0(target: Nutrients, projected: Nutrients, dish: Nutrients, factor: number): Nutrients {
  const withoutDish = scale(dish, -factor);
  const base = { ...projected };
  for (const k of Object.keys(base) as (keyof Nutrients)[]) base[k] += withoutDish[k];
  const out = { ...target };
  for (const k of Object.keys(out) as (keyof Nutrients)[]) out[k] -= base[k];
  return out;
}

/* ------------------------------------------------------------ planned rows */

/**
 * A planned meal in a list, quiet: the slot as its status, the title in the muted colour, the kcal
 * marked "planned". Today's gets a 44 px "Ate it" square on the right.
 */
export function PlannedRow({
  recipe,
  slot,
  factor,
  kcal,
  today = false,
  onOpen,
  onAte,
}: {
  recipe: Recipe;
  slot: Slot;
  factor: number;
  kcal: number;
  today?: boolean;
  onOpen: () => void;
  onAte?: () => void;
}) {
  return (
    <li className="flex min-h-[84px] items-stretch">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-stretch gap-4 px-5 py-3 text-left active:bg-tint"
      >
        <div className="min-w-0 flex-1">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {SLOT_NAME[slot]}
            {factor !== 1 && <span>· {factor}×</span>}
          </Label>
          <div className="display mt-1.5 text-[19px] text-muted-foreground leading-[1.05] tracking-[-0.02em]">
            {recipe.title}
          </div>
          <div className="mt-1.5 font-medium text-muted-foreground text-xs">
            {recipe.totalMin} min · {recipe.source.label}
          </div>
        </div>
        <div className="shrink-0 text-right text-muted-foreground">
          <div className="display text-[26px]">{fmt(kcal)}</div>
          <Label className="text-[10px]">planned</Label>
        </div>
      </button>
      {today && onAte && (
        <button
          type="button"
          onClick={onAte}
          aria-label="Ate it"
          className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-tint active:opacity-70"
        >
          <Check className="size-6" strokeWidth={2.5} />
          <Label className="text-[10px]">Ate it</Label>
        </button>
      )}
    </li>
  );
}

export function EatenRow({
  time,
  title,
  captures,
  kcal,
}: {
  time: string;
  title: string;
  captures: string;
  kcal: number;
}) {
  return (
    <li className="flex min-h-[84px] items-stretch gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold">{time}</span>
          <span className="text-muted-foreground">·</span>
          <Label className="text-muted-foreground">Analysed</Label>
        </div>
        <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">{title}</div>
        <div className="mt-1.5 font-medium text-muted-foreground text-xs">{captures}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="display text-[26px]">{fmt(kcal)}</div>
        <Label className="text-[10px] text-muted-foreground">kcal</Label>
      </div>
    </li>
  );
}

/**
 * The overview with today's planned dinner: the totals slab notes it, the day's list shows it as a
 * quiet row after the eaten meals. `slab` and `headerRight` are where the variants differ.
 */
export function OverviewMock({
  slab,
  headerRight,
  beforeToday,
  afterToday,
  onOpenPlanned,
  onAte,
  planned = PLANNED,
}: {
  slab: React.ReactNode;
  headerRight?: React.ReactNode;
  beforeToday?: React.ReactNode;
  afterToday?: React.ReactNode;
  onOpenPlanned: () => void;
  onAte: () => void;
  planned?: readonly PlannedMeal[];
}) {
  const today = DAYS[0]!;
  const proj = projection(today, planned);
  const totals = { grams: 0, items: 0, nutrients: { ...today.eaten!, salt: 0, saturatedFat: 0, sugars: 0 } };
  return (
    <>
      <Header label="Tuesday 4 Nov" title="Today" right={<div className="flex gap-2">{headerRight}</div>} />
      <main className="flex-1">
        <TotalsSlab
          totals={totals}
          label="kcal today"
          targets={GOAL.targets}
          note={
            <>
              <ChefHat className="size-3.5" strokeWidth={2.5} />1 planned · with it{" "}
              {fitWords(proj.total.energyKcal, GOAL.targets.energyKcal)}
            </>
          }
        />
        {beforeToday}
        <Strip title="Today" meta="2 meals · 1 planned" />
        <ul className="divide-y divide-border">
          {EATEN_TODAY.map((m) => (
            <EatenRow
              key={m.title}
              time={m.time}
              title={m.title}
              captures={m.captures}
              kcal={m.nutrients.energyKcal}
            />
          ))}
          {proj.list.map((p) => (
            <PlannedRow
              key={p.recipeId}
              recipe={p.recipe}
              slot={p.slot}
              factor={p.factor}
              kcal={p.nutrients.energyKcal}
              today
              onOpen={onOpenPlanned}
              onAte={onAte}
            />
          ))}
        </ul>
        {afterToday}
        <Strip title="Yesterday" meta="2,090 / 2,200 kcal" />
        <ul className="divide-y divide-border">
          <EatenRow time="19:20" title="Linsen-Dal mit Naan" captures="1 voice memo" kcal={760} />
          <EatenRow time="12:30" title="Hähnchen-Reis-Bowl mit Brokkoli" captures="Logged again" kcal={680} />
          <EatenRow time="07:50" title="Haferbrei mit Beeren und Skyr" captures="Logged again" kcal={420} />
        </ul>
      </main>
      {slab}
    </>
  );
}

/** A day's planned list with its projection words, reused by the plan views. */
export function dayProjection(day: PlanDay, planned: readonly PlannedMeal[] = PLANNED) {
  const p = projection(day, planned);
  // a day is read against the goal only once it is mostly known: today (eaten so far plus the
  // plan) or a day with all three slots planned; a lone planned dinner is "rest open", not "far off"
  const words = day.eaten || p.list.length >= 3 ? planWords(p.total.energyKcal) : null;
  return { ...p, words };
}
