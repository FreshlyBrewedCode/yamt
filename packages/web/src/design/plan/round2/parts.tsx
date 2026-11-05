// Round 2 of the planning spike: what the three composer variants (D, E, F) share. The split
// Log | Plan slab, the overview's request rows, the composer (plus, field, mic, send; voice and
// photo chips), the filters and the starters, the keyboard placeholder, and the request thread in
// the mix (A's rounds, B's suggestion bands, picks that fill the next open slot). Mock data only.
import { cn } from "cn";
import {
  ArrowRight,
  CalendarCheck,
  Camera,
  Check,
  ChefHat,
  ClipboardPaste,
  FileAudio,
  Image as ImageIcon,
  Link2,
  type LucideIcon,
  Mic,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { CaptureSheet } from "@/components/add-strip";
import { Band, BottomSlab, Label, SlabButton, Strip } from "@/components/slab";
import {
  DAYS,
  fmt,
  GOAL,
  type MockCapture,
  type PlannedMeal,
  perPortion,
  projection,
  type Recipe,
  ROUND_1,
  ROUND_2,
  SLOT_NAME,
  type Slot,
} from "../mock";
import {
  captureIcon,
  FitBar,
  FridgeTile,
  fitWords,
  Header,
  MacroChips,
  MetaLine,
  SuggestingBand,
  WhyList,
} from "../shared";

/* ------------------------------------------------------------------ filters */

export type When = "tonight" | "tomorrow" | "week" | "days";
export type TimeCap = "20" | "40" | "any";
export type Constraint = "noOven" | "veg" | "protein";

/** The structured part of a request. Sent next to the text, voice and attachments; never merged into the text. */
export interface Filters {
  when: When;
  /** With `when: "days"`: the picked weekdays. */
  days: string[];
  meals: Slot[];
  time: TimeCap;
  constraints: Constraint[];
  /** Leftovers to use up, by their chip label. */
  useUp: string[];
}

export const DEFAULT_FILTERS: Filters = {
  when: "tonight",
  days: [],
  meals: ["dinner"],
  time: "any",
  constraints: [],
  useUp: [],
};

/** The request of the mock thread: dinners Tue–Thu, 40 minutes, Wednesday without the oven, the leftovers. */
export const REQUEST_FILTERS: Filters = {
  when: "days",
  days: ["Tue", "Wed", "Thu"],
  meals: ["dinner"],
  time: "40",
  constraints: ["noOven"],
  useUp: ["½ Hokkaido", "Feta 200 g"],
};

export const WHEN_LABEL: Record<When, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  week: "Rest of the week",
  days: "Pick days",
};
export const TIME_LABEL: Record<TimeCap, string> = { "20": "≤ 20 min", "40": "≤ 40 min", any: "Any time" };
export const CONSTRAINT_LABEL: Record<Constraint, string> = {
  noOven: "No oven",
  veg: "Vegetarian",
  protein: "High protein",
};
export const LEFTOVER_CHIPS = ["½ Hokkaido", "Feta 200 g", "Koriander"];
export const WEEKDAYS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The filters as chips in a composer: nothing while they are the untouched default (tonight's dinner). */
export function chipWords(f: Filters): string[] {
  return JSON.stringify(f) === JSON.stringify(DEFAULT_FILTERS) ? [] : filterWords(f);
}

/** The filters as short words, in the order they are read: when, meals, time, constraints, use up. */
export function filterWords(f: Filters): string[] {
  const out: string[] = [];
  if (f.when === "days") out.push(dayRange(f.days));
  else out.push(WHEN_LABEL[f.when]);
  if (f.meals.length && !(f.meals.length === 1 && f.meals[0] === "dinner" && f.when === "tonight"))
    out.push(f.meals.map((m) => SLOT_NAME[m]).join(" + "));
  if (f.time !== "any") out.push(TIME_LABEL[f.time]);
  for (const c of f.constraints) out.push(CONSTRAINT_LABEL[c]);
  for (const u of f.useUp) out.push(u);
  return out;
}

function dayRange(days: string[]): string {
  if (days.length === 0) return "Pick days";
  const idx = days.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  if (consecutive && idx.length > 2) return `${WEEKDAYS[idx[0]!]}–${WEEKDAYS[idx[idx.length - 1]!]}`;
  return idx.map((i) => WEEKDAYS[i]).join(", ");
}

/** "Dinners Tue–Thu", "Tonight's dinner", "Lunches and dinners, rest of the week": the request's title. */
export function requestTitle(f: Filters): string {
  const meals =
    f.meals.length === 0 || f.meals.length === 3
      ? "Meals"
      : f.meals.map((m) => `${SLOT_NAME[m]}s`).join(" and ");
  if (f.when === "tonight")
    return `Tonight's ${f.meals.length === 1 ? SLOT_NAME[f.meals[0]!].toLowerCase() : "meals"}`;
  if (f.when === "tomorrow")
    return `Tomorrow's ${f.meals.length === 1 ? SLOT_NAME[f.meals[0]!].toLowerCase() : "meals"}`;
  if (f.when === "week") return `${meals}, rest of the week`;
  return `${meals} ${dayRange(f.days)}`;
}

/** How the agent reads it: one sentence from the filters, before the free text. */
export function requestSentence(f: Filters): string {
  const parts = [requestTitle(f).toLowerCase()];
  if (f.time !== "any") parts.push(`${TIME_LABEL[f.time]} total`);
  for (const c of f.constraints) parts.push(CONSTRAINT_LABEL[c].toLowerCase());
  if (f.useUp.length) parts.push(`using ${f.useUp.join(" and ")}`);
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A toggle chip: tint, the chosen one in the foreground fill (a choice doesn't want the user). */
export function ToggleChip({
  on,
  children,
  onClick,
  className,
  surface = "page",
}: {
  on: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  /** On tint the off chip takes the page colour so it stays visible. */
  surface?: "page" | "tint";
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 px-3.5 font-bold text-sm outline-none focus-visible:underline",
        on
          ? "bg-foreground text-background"
          : surface === "tint"
            ? "bg-background text-foreground"
            : "bg-tint text-foreground",
        className,
      )}
    >
      {on && <Check className="-ml-1 size-4" strokeWidth={3} />}
      {children}
    </button>
  );
}

/** One group of filters: a micro-label and its chips, wrapping. */
export function FilterGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-5", className)}>
      <Label className="mb-2 text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-0.5">{children}</div>
    </div>
  );
}

const toggleIn = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** All five filter groups, each editable. `surface` is where they sit (page or tint). */
export function FilterGroups({
  filters: f,
  onChange,
  surface = "tint",
  className,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  surface?: "page" | "tint";
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <FilterGroup label="When">
        {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
          <ToggleChip key={w} on={f.when === w} surface={surface} onClick={() => onChange({ ...f, when: w })}>
            {WHEN_LABEL[w]}
          </ToggleChip>
        ))}
        {f.when === "days" &&
          WEEKDAYS.map((d) => (
            <ToggleChip
              key={d}
              on={f.days.includes(d)}
              surface={surface}
              className="w-[56px] justify-center px-0"
              onClick={() => onChange({ ...f, days: toggleIn(f.days, d) })}
            >
              {d}
            </ToggleChip>
          ))}
      </FilterGroup>
      <FilterGroup label="Which meals">
        {(["breakfast", "lunch", "dinner"] as Slot[]).map((m) => (
          <ToggleChip
            key={m}
            on={f.meals.includes(m)}
            surface={surface}
            onClick={() => onChange({ ...f, meals: toggleIn(f.meals, m) })}
          >
            {SLOT_NAME[m]}
          </ToggleChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Time">
        {(Object.keys(TIME_LABEL) as TimeCap[]).map((t) => (
          <ToggleChip key={t} on={f.time === t} surface={surface} onClick={() => onChange({ ...f, time: t })}>
            {TIME_LABEL[t]}
          </ToggleChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Only">
        {(Object.keys(CONSTRAINT_LABEL) as Constraint[]).map((c) => (
          <ToggleChip
            key={c}
            on={f.constraints.includes(c)}
            surface={surface}
            onClick={() => onChange({ ...f, constraints: toggleIn(f.constraints, c) })}
          >
            {CONSTRAINT_LABEL[c]}
          </ToggleChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Use up · from the last meals">
        {LEFTOVER_CHIPS.map((u) => (
          <ToggleChip
            key={u}
            on={f.useUp.includes(u)}
            surface={surface}
            onClick={() => onChange({ ...f, useUp: toggleIn(f.useUp, u) })}
          >
            {u}
          </ToggleChip>
        ))}
      </FilterGroup>
    </div>
  );
}

/* ----------------------------------------------------------------- starters */

export interface Starter {
  id: string;
  /** The prompt the app fills into the composer. */
  text: string;
  /** The number it carries ("82", "½", "3") and what it is. */
  number: string;
  unit: string;
  /** One line of why, from the user's data. */
  why: string;
  filters?: Partial<Filters>;
}

/** Generated from context: what's open, leftovers, variety, a liked meal, the season, the last request. */
export const STARTERS: Starter[] = [
  {
    id: "protein",
    text: "High protein tonight",
    number: "82",
    unit: "g protein open tonight",
    why: "1,100 kcal left of 2,200 after 2 meals",
    filters: { when: "tonight", meals: ["dinner"], constraints: ["protein"] },
  },
  {
    id: "pumpkin",
    text: "Something with the leftover pumpkin",
    number: "½",
    unit: "Hokkaido to use up",
    why: "Bought Saturday, with 200 g feta still open",
    filters: { useUp: ["½ Hokkaido", "Feta 200 g"] },
  },
  {
    id: "new",
    text: "Something new: no fish in 3 weeks",
    number: "3",
    unit: "weeks without fish",
    why: "Chicken 3× this week, oats 6×",
  },
  {
    id: "like",
    text: "Like the Linsen-Dal, but different",
    number: "760",
    unit: "kcal · Linsen-Dal mit Naan",
    why: "Yesterday 19:20, 41 g protein, you logged it twice",
  },
  {
    id: "season",
    text: "Something in season",
    number: "Nov",
    unit: "Kürbis, Grünkohl, Rosenkohl, Birne",
    why: "From the seasonal calendar",
  },
  {
    id: "again",
    text: "Pumpkin dinners Tue–Thu, like last week",
    number: "Sat",
    unit: "your last request",
    why: "3 picked of 7 suggested · reuses its filters",
    filters: REQUEST_FILTERS,
  },
];

/** The quick steers at the end of a round. */
export const STEERS = [
  "Less meat",
  "Faster",
  "Lighter",
  "More like the second one",
  "Something else entirely",
];

/** A starter as a plain 68 px row: the prompt bold, the why muted, the number right. */
export function StarterRow({ s, onPick }: { s: Starter; onPick: (s: Starter) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(s)}
        className="flex min-h-[68px] w-full items-center gap-4 px-5 py-2.5 text-left active:bg-tint"
      >
        <Sparkles className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-snug">{s.text}</span>
          <span className="mt-0.5 block font-medium text-muted-foreground text-xs">{s.why}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="display block text-[22px]">{s.number}</span>
          <Label className="mt-0.5 max-w-[96px] truncate text-[10px] text-muted-foreground">{s.unit}</Label>
        </span>
      </button>
    </li>
  );
}

/* ----------------------------------------------------------------- composer */

export type AttachmentKind = "voice" | "photo" | "link" | "file";
export interface Attachment {
  kind: AttachmentKind;
  label: string;
}

const ATTACH: [string, string, LucideIcon][] = [
  ["Photo", "Camera, or the fridge right now", Camera],
  ["From library", "Screenshots, photos", ImageIcon],
  ["Link", "A recipe page", Link2],
  ["Audio file", "A voice message from elsewhere", FileAudio],
  ["Paste", "Text, a link or an image from the clipboard", ClipboardPaste],
];

/** The plus button's sheet: what can be attached, as rows. */
export function AttachSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <CaptureSheet open={open} onClose={onClose} title="Attach" description="To this request">
      <ul className="divide-y divide-border border-border border-t">
        {ATTACH.map(([name, detail, Icon]) => (
          <li key={name}>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[68px] w-full items-center gap-4 px-5 py-3 text-left active:bg-tint"
            >
              <span className="flex size-12 shrink-0 items-center justify-center bg-tint">
                <Icon className="size-6" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{name}</span>
                <span className="block font-medium text-muted-foreground text-sm">{detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </CaptureSheet>
  );
}

/** A voice memo, a photo, a link or a file in the composer, before sending. 44 px, square, removable. */
export function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  return (
    <span className="flex h-11 shrink-0 items-center bg-tint">
      {a.kind === "photo" ? (
        <FridgeTile className="size-11" />
      ) : (
        <span className="flex size-11 items-center justify-center">
          {a.kind === "voice" ? (
            <Play className="size-5" strokeWidth={2.5} />
          ) : a.kind === "link" ? (
            <Link2 className="size-5" strokeWidth={2.5} />
          ) : (
            <FileAudio className="size-5" strokeWidth={2.5} />
          )}
        </span>
      )}
      <span className="flex min-w-0 flex-col pr-1">
        <span className="max-w-[128px] truncate font-bold text-sm leading-tight">{a.label}</span>
        <Label className="text-[10px] text-muted-foreground">
          {a.kind === "voice" ? "voice · transcribed later" : a.kind}
        </Label>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${a.label}`}
        className="flex size-11 shrink-0 items-center justify-center text-muted-foreground"
      >
        <X className="size-4" strokeWidth={2.5} />
      </button>
    </span>
  );
}

/** Chosen filters as removable chips in the composer (D and F carry them there). */
export function FilterChips({ words, onClear }: { words: string[]; onClear?: () => void }) {
  if (words.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5">
      {words.map((w) => (
        <span
          key={w}
          className="flex h-9 items-center bg-foreground pl-3 font-bold text-background text-[13px]"
        >
          {w}
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${w}`}
            className="flex size-9 items-center justify-center text-background/70"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * The composer: plus (attach), the field, the mic; a lime send square once there is something to
 * send (`send`). Chips (filters) and attachments sit above the field. `size="tall"` is the
 * form-like field of E (three lines); `"row"` is the chat row of D and F.
 */
export function Composer({
  text,
  placeholder = "What do you fancy?",
  focused = false,
  attachments = [],
  chips,
  size = "row",
  send,
  onSend,
  onAttach,
  onMic,
  className,
  recording = false,
}: {
  text: string;
  placeholder?: string;
  focused?: boolean;
  attachments?: Attachment[];
  chips?: React.ReactNode;
  size?: "row" | "tall";
  /** Show the lime send square (D: the composer is the bottom slab). */
  send?: boolean;
  onSend?: () => void;
  onAttach?: () => void;
  onMic?: () => void;
  className?: string;
  recording?: boolean;
}) {
  const has = text.length > 0 || attachments.length > 0;
  const field = (
    <div
      className={cn(
        "min-w-0 flex-1 font-medium text-base leading-snug",
        size === "tall" ? "min-h-[96px] px-5 py-4" : "min-h-12 px-4 py-3",
        focused ? "bg-lime-soft" : "bg-tint",
        !text && "text-muted-foreground",
      )}
    >
      {text || placeholder}
      {focused && (
        <span className="ml-px inline-block h-[1.1em] w-0.5 translate-y-[3px] bg-foreground" aria-hidden />
      )}
    </div>
  );
  const square = "flex size-12 shrink-0 items-center justify-center bg-tint active:opacity-70";
  return (
    <div className={cn("bg-background", className)}>
      {chips && <div className="px-5 pb-2">{chips}</div>}
      {attachments.length > 0 && (
        <div className="flex gap-0.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
          {attachments.map((a) => (
            <AttachmentChip key={a.label} a={a} />
          ))}
        </div>
      )}
      {size === "tall" ? (
        <div className="px-5">
          {field}
          <div className="mt-0.5 flex gap-0.5">
            <button
              type="button"
              onClick={onAttach}
              className="flex h-12 flex-1 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70"
            >
              <Plus className="size-5" strokeWidth={2.5} /> Attach
            </button>
            <button
              type="button"
              onClick={onMic}
              className={cn(
                "flex h-12 flex-1 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] active:opacity-70",
                recording && "bg-lime text-lime-foreground",
              )}
            >
              <Mic className="size-5" strokeWidth={2.5} /> {recording ? "0:04 · stop" : "Speak"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-0.5 px-5">
          <button type="button" onClick={onAttach} aria-label="Attach" className={square}>
            <Plus className="size-6" strokeWidth={2.5} />
          </button>
          {field}
          <button
            type="button"
            onClick={onMic}
            aria-label={recording ? "Stop recording" : "Record a voice memo"}
            className={cn(square, recording && "bg-lime text-lime-foreground")}
          >
            {recording ? (
              <span className="size-5 bg-current" />
            ) : (
              <Mic className="size-6" strokeWidth={2.5} />
            )}
          </button>
          {send && (
            <button
              type="button"
              onClick={onSend}
              disabled={!has}
              aria-label="Suggest"
              className="flex size-12 shrink-0 items-center justify-center bg-lime text-lime-foreground active:opacity-80 disabled:bg-tint disabled:text-muted-foreground"
            >
              <Sparkles className="size-6" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- keyboard */

/**
 * The iOS keyboard, approximated: the screen is clamped to the viewport, the main scrolls, the
 * footer sits above a 336 px placeholder band. `scroll` says where the main rests (a chat keeps
 * the field in view by scrolling to the end).
 */
export function KeyboardFrame({
  children,
  scroll = "top",
}: {
  children: React.ReactNode;
  scroll?: "top" | "bottom";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = ref.current?.querySelector("main");
    if (main && scroll === "bottom") main.scrollTop = main.scrollHeight;
  }, [scroll]);
  return (
    <div
      ref={ref}
      className="flex h-dvh flex-col overflow-hidden [&>footer]:static [&>main]:min-h-0 [&>main]:flex-1 [&>main]:overflow-y-auto"
    >
      {children}
      <div className="h-[336px] shrink-0 bg-tint px-1.5 pt-2" role="img" aria-label="Keyboard (placeholder)">
        {["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((keys, row) => (
          <div key={keys} className="mb-1.5 flex justify-center gap-1.5">
            {row === 2 && <span className="h-[42px] w-[42px] bg-foreground/10" />}
            {[...keys].map((k) => (
              <span key={k} className="h-[42px] w-[32px] bg-background" />
            ))}
            {row === 2 && <span className="h-[42px] w-[42px] bg-foreground/10" />}
          </div>
        ))}
        <div className="flex justify-center gap-1.5">
          <span className="h-[42px] w-[86px] bg-foreground/10" />
          <span className="h-[42px] w-[180px] bg-background" />
          <span className="h-[42px] w-[86px] bg-foreground/10" />
        </div>
        <Label className="mt-6 text-center text-[10px] text-muted-foreground">iOS keyboard · 336 px</Label>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- overview parts */

/** The overview's bottom slab: Log (lime) | Plan (ink inside the slab), one footer, full width together. */
export function SplitSlab({ onLog, onPlan }: { onLog: () => void; onPlan: () => void }) {
  return (
    <BottomSlab>
      <div className="flex">
        <SlabButton className="h-full flex-1 text-[22px]" onClick={onLog}>
          <Plus className="size-8" strokeWidth={3} /> Log
        </SlabButton>
        <SlabButton tone="ink" className="h-full w-[42%] text-[22px]" onClick={onPlan}>
          <ChefHat className="size-7" strokeWidth={2.5} /> Plan
        </SlabButton>
      </div>
    </BottomSlab>
  );
}

/**
 * Planning requests on the overview, under the totals: one still suggesting (quiet, like an
 * analysing meal) and one with suggestions waiting (a full lime row, like needs-input).
 */
export function RequestRows({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <Strip title="Planning" meta="2 requests" />
      <ul className="divide-y divide-border">
        <li className="bg-lime text-lime-foreground">
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 text-left active:opacity-80"
          >
            <div className="min-w-0 flex-1">
              <Label className="flex items-center gap-2">
                <Sparkles className="size-3.5" strokeWidth={2.5} /> Suggested · 4 for you
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
              <span className="size-2 animate-pulse bg-current" /> Suggesting · round 1
            </Label>
            <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
              Weekend lunches
            </div>
            <div className="mt-1.5 font-medium text-xs">
              “Something I can take along” · started 16:04 · a push arrives
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="display text-[26px]">—</div>
            <Label className="text-[10px]">2 slots</Label>
          </div>
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------- the thread */

export type Verdict = { kind: "picked"; date: string; slot: Slot } | { kind: "rejected" };
export type Verdicts = Record<string, Verdict | undefined>;

/** The slots a request spans, in order: Tue, Wed, Thu dinner. */
export const REQUEST_SLOTS: { date: string; slot: Slot }[] = [
  { date: "2026-11-04", slot: "dinner" },
  { date: "2026-11-05", slot: "dinner" },
  { date: "2026-11-06", slot: "dinner" },
];

export const ROUND_1_INPUTS: MockCapture[] = [
  {
    kind: "note",
    title: "Something with pumpkin, I still have half a Hokkaido. Wednesday without the oven.",
    detail: "Text",
  },
  { kind: "photo", title: "Fridge", detail: "Photo · feta, spinach, eggs seen" },
  { kind: "link", title: "chefkoch.de/rezepte/kuerbis-curry", detail: "Link" },
];
export const ROUND_2_INPUTS: MockCapture[] = [
  { kind: "audio", title: "Less meat. More like the second one, but faster.", detail: "Voice · 0:06" },
];

/** Picks become planned meals; the request's own picks fill its slots in order. */
export function pickedMeals(v: Verdicts): PlannedMeal[] {
  return Object.entries(v).flatMap(([id, x]) =>
    x?.kind === "picked" ? [{ recipeId: id, date: x.date, slot: x.slot, factor: 1 }] : [],
  );
}

/** The next open slot of the request, given its picks. */
export function nextOpen(v: Verdicts): { date: string; slot: Slot } | null {
  const taken = new Set(pickedMeals(v).map((p) => `${p.date}/${p.slot}`));
  return REQUEST_SLOTS.find((s) => !taken.has(`${s.date}/${s.slot}`)) ?? null;
}

export const slotWords = (s: { date: string; slot: Slot }) =>
  `${DAYS.find((d) => d.date === s.date)?.weekday ?? s.date} ${SLOT_NAME[s.slot].toLowerCase()}`;

/** What the user asked: the filter chips and the inputs, on tint. */
export function AskedBand({
  title,
  meta,
  words = [],
  inputs,
}: {
  title: string;
  meta: string;
  words?: string[];
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

/** The request's slots as the thread's ink slab: each with what's picked and the day's projection. */
export function SlotsSlab({ verdicts }: { verdicts: Verdicts }) {
  const planned = pickedMeals(verdicts);
  const filled = planned.length;
  return (
    <Band tone="ink" className="px-3 pt-4 pb-4">
      <div className="grid grid-cols-3 gap-1">
        {REQUEST_SLOTS.map((s) => {
          const day = DAYS.find((d) => d.date === s.date)!;
          const pick = planned.find((p) => p.date === s.date && p.slot === s.slot);
          const r = pick ? ROUND_ALL.get(pick.recipeId) : undefined;
          const p = projection(day, planned);
          return (
            <div
              key={s.date}
              className={cn(
                "flex h-[92px] flex-col justify-between p-2",
                pick ? "bg-ink-foreground text-ink" : "bg-ink-line/40 text-ink-muted",
              )}
            >
              <span className="flex items-center justify-between">
                <Label className="text-[11px]">{day.weekday}</Label>
                <Label className="text-[10px] opacity-70">{SLOT_NAME[s.slot]}</Label>
              </span>
              <span>
                <span className="display block truncate text-[15px] leading-tight tracking-[-0.02em]">
                  {r ? r.title : "Open"}
                </span>
                <Label className="mt-1 block text-[10px] opacity-70">
                  {pick
                    ? `${fmt(p.total.energyKcal)} with it`
                    : day.eaten
                      ? `${fmt(day.eaten.energyKcal)} eaten`
                      : "nothing yet"}
                </Label>
              </span>
            </div>
          );
        })}
      </div>
      <Label className="mt-3 flex items-center gap-2 px-1 text-ink-muted">
        <ChefHat className="size-3.5" strokeWidth={2.5} /> {filled} of 3 slots filled · a pick takes the next
        open one
      </Label>
    </Band>
  );
}

const ROUND_ALL = new Map([...ROUND_1, ...ROUND_2].map((r) => [r.id, r]));

/**
 * A suggestion as a full-width band (B's): the title and kcal, the target day's bar with the dish
 * added and where that lands, the protein still open, two why-it-fits lines, the source. Pick
 * (ink) fills the next open slot; No folds the row.
 */
export function MixBand({
  r,
  verdict,
  target,
  planned,
  onPick,
  onReject,
  onUndo,
  onOpen,
  onChange,
}: {
  r: Recipe;
  verdict: Verdict | undefined;
  /** The slot a pick would take (null: all filled). */
  target: { date: string; slot: Slot } | null;
  planned: PlannedMeal[];
  onPick: () => void;
  onReject: () => void;
  onUndo: () => void;
  onOpen: () => void;
  onChange: () => void;
}) {
  const n = perPortion(r);
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
  const at = picked ?? target;
  const day = at ? DAYS.find((d) => d.date === at.date)! : DAYS[0]!;
  // the day's total without this dish (eaten plus other picks), then with it
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
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {slotWords(picked)}
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
        <Label className="text-muted-foreground">{at ? `${day.weekday} with it` : "Today with it"}</Label>
        <span className="font-bold text-sm">{fitWords(total, GOAL.targets.energyKcal)}</span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <MacroChips n={n} />
        <span className="shrink-0 font-bold text-sm">
          {fmt(n.protein)} <span className="text-muted-foreground">of {fmt(openP)} g P open</span>
        </span>
      </div>
      <WhyList r={{ ...r, why: r.why.slice(0, 2), note: undefined }} compact className="mt-3" />
      <MetaLine r={r} className="mt-3" />
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
            onClick={onPick}
            disabled={!target}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-foreground font-bold text-background text-sm uppercase tracking-[0.08em] active:opacity-80 disabled:bg-tint disabled:text-muted-foreground"
          >
            <Check className="size-5" strokeWidth={3} />{" "}
            {target ? `Pick · ${slotWords(target)}` : "All slots filled"}
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

/** Round 1 as the user left it before round 2: the curry picked for Tue, the oven dish rejected. */
export const AFTER_ROUND_1: Verdicts = {
  curry: { kind: "picked", date: "2026-11-04", slot: "dinner" },
  ofen: { kind: "rejected" },
};
/** After round 2: the shakshuka for Wed as well. */
export const AFTER_ROUND_2: Verdicts = {
  ...AFTER_ROUND_1,
  shakshuka: { kind: "picked", date: "2026-11-05", slot: "dinner" },
};

export type ThreadStage = "suggesting" | "round1" | "round2";

/**
 * The request thread in the mix: the slots slab, then per round what you asked and the
 * suggestions. `stage` says how far it is; `tail` is the variant's steering composer.
 */
export function Thread({
  stage,
  verdicts,
  setVerdicts,
  onBack,
  onPlanView,
  onOpen,
  onChange,
  tail,
  right,
}: {
  stage: ThreadStage;
  verdicts: Verdicts;
  setVerdicts: (v: Verdicts) => void;
  onBack: () => void;
  onPlanView: () => void;
  onOpen: (r: Recipe) => void;
  onChange: (r: Recipe) => void;
  tail?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const planned = pickedMeals(verdicts);
  const target = nextOpen(verdicts);
  const list = (recipes: Recipe[]) => (
    <ul className="divide-y divide-border">
      {recipes.map((r) => (
        <MixBand
          key={r.id}
          r={r}
          verdict={verdicts[r.id]}
          target={target}
          planned={planned}
          onPick={() => target && setVerdicts({ ...verdicts, [r.id]: { kind: "picked", ...target } })}
          onReject={() => setVerdicts({ ...verdicts, [r.id]: { kind: "rejected" } })}
          onUndo={() => setVerdicts({ ...verdicts, [r.id]: undefined })}
          onOpen={() => onOpen(r)}
          onChange={() => onChange(r)}
        />
      ))}
    </ul>
  );
  const status = stage === "suggesting" ? "suggesting" : "suggested";
  return (
    <>
      <Header
        label="Request"
        status={status}
        title={requestTitle(REQUEST_FILTERS)}
        onBack={onBack}
        right={
          right ?? (
            <button
              type="button"
              onClick={onPlanView}
              className="flex size-12 shrink-0 items-center justify-center bg-tint active:opacity-70"
              aria-label="Plan view"
            >
              <CalendarCheck className="size-6" strokeWidth={2.5} />
            </button>
          )
        }
      />
      <main className="flex-1">
        <SlotsSlab verdicts={verdicts} />
        <AskedBand
          title="You asked"
          meta="Round 1 · 15:41"
          words={filterWords(REQUEST_FILTERS)}
          inputs={ROUND_1_INPUTS}
        />
        {stage === "suggesting" ? (
          <SuggestingBand round={1} />
        ) : (
          <>
            <Strip title="Round 1" meta={`${ROUND_1.length} suggestions`} />
            {list(ROUND_1)}
          </>
        )}
        {stage === "round2" && (
          <>
            <AskedBand title="You added" meta="Round 2 · 16:02" words={["Faster"]} inputs={ROUND_2_INPUTS} />
            <Strip title="Round 2" meta={`${ROUND_2.length} suggestions`} />
            {list(ROUND_2)}
          </>
        )}
        {tail}
      </main>
    </>
  );
}

/** The mock attachments of the composer's "attached" state. */
export const ATTACHED: Attachment[] = [
  { kind: "voice", label: "0:06" },
  { kind: "photo", label: "Fridge" },
  { kind: "link", label: "chefkoch.de/rezepte/kuerbis-curry" },
];
export const TYPED = "Something with pumpkin, I still have half a Hokkaido. Wednesday without the oven.";
export const STEER_TYPED = "Less meat. More like the second one, but faster.";

/** The state every variant's composer holds. */
export function useComposer(initial: { text?: string; filters?: Filters; attachments?: Attachment[] } = {}) {
  const [text, setText] = useState(initial.text ?? "");
  const [filters, setFilters] = useState<Filters>(initial.filters ?? DEFAULT_FILTERS);
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments ?? []);
  const [attach, setAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const pickStarter = (s: Starter) => {
    setText(s.text);
    if (s.filters) setFilters({ ...DEFAULT_FILTERS, ...s.filters });
  };
  const mic = () => {
    if (recording) setAttachments([...attachments, { kind: "voice", label: "0:04" }]);
    setRecording(!recording);
  };
  return {
    text,
    setText,
    filters,
    setFilters,
    attachments,
    setAttachments,
    attach,
    setAttach,
    recording,
    mic,
    pickStarter,
    has: text.length > 0 || attachments.length > 0,
  };
}
