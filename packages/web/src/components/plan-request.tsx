// The planning screens' parts (#47, direction G of spike #37): starter bands, the filter summary
// and the filter form, the request's slots as the thread's ink slab, "You asked" / "You added", the
// rounds' rows (a ready suggestion as a band with its day's bar, an outlined idea as a quiet
// placeholder, an idea that couldn't be completed struck through) and the overview's Planning strip.
import { Link } from "@tanstack/react-router";
import type {
  MealSlot,
  PlanDay,
  PlanningInput,
  PlanningRequest,
  PlanningRequestSummary,
  PlanningRoundView,
  PlanningSuggestionView,
  PlanningTranscript,
  ResolvedPlanningFilters,
} from "@yamt/shared";
import { cn } from "cn";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChefHat,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  ImageIcon,
  Link2,
  type LucideIcon,
  Mic,
  NotebookPen,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { formatNumber, formatTime, formatWeekday, plural, shortUrl } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import type { PlanInputEntry, PlanningEntry } from "@/lib/outbox";
import {
  CONSTRAINT_LABEL,
  constraintLabel,
  draftDays,
  type FilterDraft,
  MODE_LABEL,
  pickTarget,
  slotWords,
  TIME_CAPS,
  timeLabel,
  WHEN_LABEL,
  type WhenPreset,
} from "@/lib/plan-request";
import { nextDays, SLOT_NAME, SLOTS, sourceLabel } from "@/lib/planning";
import { planError, usePickSuggestion, useRejectSuggestion, useUnplanMeal } from "@/lib/queries";
import { formatDuration } from "@/lib/recorder";
import type { Starter } from "@/lib/starters";
import { Chips, ChoiceList, ChoiceRow } from "./choice";
import { FitBar } from "./planning";
import { Band, Label, Strip } from "./slab";

/* ------------------------------------------------------------------- starters */

/**
 * A starter as a band: the number big on the left with what it is, the idea and its why on the
 * right. The first is the entry screen's ink slab; the rest alternate tint and plain.
 */
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
          "flex w-full items-center gap-4 px-5 text-left outline-none active:opacity-80 focus-visible:underline",
          ink ? "bg-ink py-5 text-ink-foreground" : tone === "tint" ? "bg-tint py-4" : "py-4",
        )}
        data-testid="starter"
        data-starter={s.id}
      >
        <span className={cn("shrink-0", ink ? "w-[120px]" : "w-[104px]")}>
          <span className={cn("display block truncate", ink ? "text-[56px]" : "text-[36px]")}>
            {s.number}
          </span>
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

/* --------------------------------------------------------------------- filters */

/** The row above the composer that opens the filter page: "For Tonight · Dinner · cook 2". */
export function FilterSummary({ words, onOpen }: { words: string[]; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-12 w-full items-center gap-3 bg-tint px-5 text-left outline-none active:opacity-70 focus-visible:underline"
      aria-label={`Filters: ${words.join(", ")}`}
      data-testid="filter-summary"
    >
      <Label className="shrink-0 text-muted-foreground">For</Label>
      <span className="min-w-0 flex-1 truncate font-bold text-sm">{words.join(" · ")}</span>
      <ChevronRight className="size-5 shrink-0" strokeWidth={2.5} />
    </button>
  );
}

/** A toggle chip: tint, the chosen one in the foreground fill (a choice doesn't want the user). */
function ToggleChip({
  on,
  children,
  onClick,
  className,
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 px-3.5 font-bold text-sm outline-none focus-visible:underline",
        on ? "bg-foreground text-background" : "bg-tint text-foreground",
        className,
      )}
    >
      {on && <Check className="-ml-1 size-4" strokeWidth={3} />}
      {children}
    </button>
  );
}

/** One group of filters: a micro-label and its chips, wrapping. */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="px-5" aria-label={label}>
      <Label className="mb-2 text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-0.5">{children}</div>
    </fieldset>
  );
}

const toggleIn = <T,>(list: readonly T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/**
 * The filter page's groups: when (presets, or days picked from the next seven), which meals, the
 * time cap, constraints, what to use up (typed), the recipe source, portions to cook and how many
 * suggestions. Every change lands in the draft at once.
 */
export function FilterForm({
  draft,
  filters,
  defaults,
  today,
  onChange,
}: {
  draft: FilterDraft;
  filters: ResolvedPlanningFilters;
  defaults: Pick<ResolvedPlanningFilters, "sourceMode" | "count" | "portionsCooked">;
  today: string;
  onChange: (d: FilterDraft) => void;
}) {
  const when = draft.when ?? "today";
  const [useUp, setUseUp] = useState("");
  const addUseUp = () => {
    const t = useUp.trim();
    if (!t) return;
    const list = filters.useUp.flatMap((u) => ("text" in u ? [u.text] : []));
    if (!list.includes(t)) onChange({ ...draft, useUp: [...list, t] });
    setUseUp("");
  };
  const counts = [2, 3, 4, 5].includes(filters.count) ? [2, 3, 4, 5] : [2, 3, 4, 5, filters.count].sort();
  const cooks = [1, 2, 3, 4].includes(filters.portionsCooked)
    ? [1, 2, 3, 4]
    : [1, 2, 3, 4, filters.portionsCooked].sort();
  return (
    <div data-testid="filter-form">
      <div className="space-y-4 pt-4 pb-5">
        <FilterGroup label="When">
          {(Object.keys(WHEN_LABEL) as WhenPreset[]).map((w) => (
            <ToggleChip
              key={w}
              on={when === w}
              onClick={() =>
                onChange({
                  ...draft,
                  when: w,
                  // picking days starts from what the preset meant
                  ...(w === "days" && when !== "days" ? { days: draftDays(draft, today) } : {}),
                })
              }
            >
              {WHEN_LABEL[w]}
            </ToggleChip>
          ))}
          {when === "days" &&
            nextDays(today).map((d) => (
              <ToggleChip
                key={d}
                on={filters.days.includes(d)}
                className="w-[60px] justify-center px-0"
                onClick={() => onChange({ ...draft, days: toggleIn(filters.days, d) })}
              >
                {d === today ? "Today" : formatWeekday(d)}
              </ToggleChip>
            ))}
        </FilterGroup>
        <FilterGroup label="Which meals">
          {SLOTS.map((s) => (
            <ToggleChip
              key={s}
              on={filters.slots.includes(s)}
              onClick={() => {
                const next = toggleIn(filters.slots, s);
                if (next.length) onChange({ ...draft, slots: next });
              }}
            >
              {SLOT_NAME[s]}
            </ToggleChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Time">
          {TIME_CAPS.map((t) => (
            <ToggleChip
              key={String(t)}
              on={filters.timeCapMin === t}
              onClick={() => onChange({ ...draft, timeCapMin: t })}
            >
              {timeLabel(t)}
            </ToggleChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Only">
          {[...new Set([...Object.keys(CONSTRAINT_LABEL), ...filters.constraints])].map((c) => (
            <ToggleChip
              key={c}
              on={filters.constraints.includes(c)}
              onClick={() => onChange({ ...draft, constraints: toggleIn(filters.constraints, c) })}
            >
              {constraintLabel(c)}
            </ToggleChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Use up">
          {filters.useUp.flatMap((u) =>
            "text" in u
              ? [
                  <ToggleChip
                    key={u.text}
                    on
                    onClick={() =>
                      onChange({
                        ...draft,
                        useUp: filters.useUp.flatMap((x) =>
                          "text" in x && x.text !== u.text ? [x.text] : [],
                        ),
                      })
                    }
                  >
                    {u.text}
                  </ToggleChip>,
                ]
              : [],
          )}
          <form
            className="flex h-11 min-w-0 flex-1 basis-48"
            onSubmit={(e) => {
              e.preventDefault();
              addUseUp();
            }}
          >
            <input
              value={useUp}
              onChange={(e) => setUseUp(e.target.value)}
              onBlur={addUseUp}
              placeholder="e.g. ½ Hokkaido"
              aria-label="Something to use up"
              enterKeyHint="done"
              maxLength={120}
              className="h-11 min-w-0 flex-1 bg-tint px-3.5 font-medium text-sm outline-none placeholder:text-muted-foreground focus:bg-lime-soft"
            />
          </form>
        </FilterGroup>
      </div>
      <Strip title="Recipes" meta={`default · ${MODE_LABEL[defaults.sourceMode].short}`} />
      <ChoiceList label="Recipe source" data-testid="filter-source-mode">
        {(["published", "adapted", "composed"] as const).map((m) => (
          <ChoiceRow
            key={m}
            title={MODE_LABEL[m].title}
            detail={MODE_LABEL[m].detail}
            selected={filters.sourceMode === m}
            onSelect={() => onChange({ ...draft, sourceMode: m })}
            data-mode={m}
          />
        ))}
      </ChoiceList>
      <Strip title="Portions" meta="per recipe" />
      <div className="px-5 pt-4 pb-5">
        <Label className="mb-2 text-muted-foreground">Cook</Label>
        <Chips
          label="Portions to cook"
          options={cooks.map((p) => ({
            value: p,
            label: p === defaults.portionsCooked ? "default" : p === 1 ? "portion" : "portions",
            sub: String(p),
          }))}
          value={filters.portionsCooked}
          onChange={(portionsCooked) => onChange({ ...draft, portionsCooked })}
        />
        <p className="mt-2 font-medium text-muted-foreground text-sm">
          {filters.portionsCooked === 1
            ? "One portion, nothing left over."
            : `Eat one, ${plural(filters.portionsCooked - 1, "portion")} left over.`}
        </p>
        <Label className="mt-5 mb-2 text-muted-foreground">Suggestions per round</Label>
        <Chips
          label="Suggestions per round"
          options={counts.map((n) => ({
            value: n,
            label: n === defaults.count ? "default" : "ideas",
            sub: String(n),
          }))}
          value={filters.count}
          onChange={(count) => onChange({ ...draft, count })}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the thread */

/** The request's slots as the thread's ink slab: what each holds and its day's projection. */
export function SlotsSlab({
  filters,
  days,
  picked,
  today,
}: {
  filters: ResolvedPlanningFilters;
  days: readonly PlanDay[] | undefined;
  /** This request's picks, on their planned meals' day and slot. */
  picked: readonly { title: string; date: string; slot: MealSlot }[];
  today: string;
}) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const cells = filters.days.flatMap((date) => filters.slots.map((slot) => ({ date, slot })));
  let filled = 0;
  const rendered = cells.map(({ date, slot }) => {
    const day = byDate.get(date);
    const pick = picked.find((p) => p.date === date && p.slot === slot);
    const other =
      day?.plannedMeals.find((p) => p.slot === slot && p.status === "planned")?.title ??
      day?.meals.find((m) => m.slot === slot)?.title ??
      null;
    const past = date < today;
    if (pick || other) filled++;
    const projected = day?.projected?.nutrients.energyKcal ?? null;
    const eaten = day?.eaten?.nutrients.energyKcal ?? null;
    return (
      <div
        key={`${date}/${slot}`}
        className={cn(
          "flex h-[92px] min-w-0 flex-col justify-between p-2",
          pick ? "bg-ink-foreground text-ink" : "bg-ink-line/40 text-ink-muted",
        )}
        data-testid="slot"
        data-filled={pick ? "picked" : other ? "taken" : "open"}
      >
        <span className="flex items-center justify-between gap-1">
          <Label className="truncate text-[11px]">{date === today ? "Today" : formatWeekday(date)}</Label>
          <Label className="text-[10px] opacity-70">{SLOT_NAME[slot]}</Label>
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "display block truncate text-[15px] leading-tight tracking-[-0.02em]",
              !pick && other && "text-ink-foreground",
            )}
          >
            {pick?.title ?? other ?? (past ? "Past" : "Open")}
          </span>
          <Label className="mt-1 block truncate text-[10px] opacity-70">
            {pick && projected !== null
              ? `${formatNumber(projected)} with it`
              : eaten !== null
                ? `${formatNumber(eaten)} eaten`
                : "nothing yet"}
          </Label>
        </span>
      </div>
    );
  });
  return (
    <Band tone="ink" className="px-3 pt-4 pb-4" data-testid="slots-slab">
      <div className="grid grid-cols-3 gap-1">{rendered}</div>
      <Label className="mt-3 flex items-start gap-2 px-1 text-ink-muted">
        <ChefHat className="mt-px size-3.5 shrink-0" strokeWidth={2.5} />
        <span>
          {filled} of {plural(cells.length, "slot")} filled · a pick takes its proposed slot, else the next
          open one
        </span>
      </Label>
    </Band>
  );
}

/** One input as a line of "You asked" / "You added". */
export interface InputLine {
  id: string;
  icon: LucideIcon;
  /** Quoted for what the user said or typed. */
  text: string;
  quoted: boolean;
  detail: string;
  /** Still in the upload queue: "Sending", "Waiting for network", or the server's refusal. */
  pending?: { label: string; refused: boolean };
}

/** The server's inputs (retracted ones left out) as lines, voice ones with their transcript. */
export function inputLines(
  inputs: readonly PlanningInput[],
  transcripts: readonly PlanningTranscript[],
): InputLine[] {
  const byInput = new Map(transcripts.map((t) => [t.inputId, t]));
  return inputs
    .filter((i) => i.retractedAt === null)
    .map((i): InputLine => {
      if (i.kind === "text")
        return { id: i.id, icon: NotebookPen, text: i.text ?? "", quoted: true, detail: "Text" };
      if (i.kind === "link") {
        return {
          id: i.id,
          icon: Link2,
          text: shortUrl(i.url ?? ""),
          quoted: false,
          detail: i.text ? `Link · ${i.text}` : "Link",
        };
      }
      if (i.kind === "audio") {
        const t = byInput.get(i.id);
        const length = t?.durationMs ? ` · ${formatDuration(t.durationMs)}` : "";
        if (t?.status === "done" && t.text) {
          return { id: i.id, icon: Mic, text: t.text, quoted: true, detail: `Voice${length}` };
        }
        return {
          id: i.id,
          icon: Mic,
          text: t?.status === "failed" ? "Couldn't transcribe" : "Transcribing…",
          quoted: false,
          detail: `Voice${length}`,
        };
      }
      return {
        id: i.id,
        icon: i.kind === "image" ? ImageIcon : FileText,
        text: i.fileName ?? (i.kind === "image" ? "Photo" : "File"),
        quoted: false,
        detail: i.kind === "image" ? "Photo" : "File",
      };
    });
}

/** What is still in the upload queue for a request, as lines with their state. */
export function pendingLines(
  entries: readonly PlanningEntry[],
  sending: string | null,
  online: boolean,
): InputLine[] {
  return entries.flatMap((e): InputLine[] => {
    const pending = {
      label: e.failed
        ? (e.error ?? "Refused")
        : e.id === sending
          ? "Sending"
          : online
            ? "Queued"
            : "Waiting for network",
      refused: e.failed,
    };
    if (e.type === "plan-request") {
      return e.text
        ? [{ id: e.id, icon: NotebookPen, text: e.text, quoted: true, detail: "Text", pending }]
        : [];
    }
    if (e.type !== "plan-input") return [];
    return [inputLineOf(e, pending)];
  });
}

function inputLineOf(e: PlanInputEntry, pending: InputLine["pending"]): InputLine {
  const c = e.input;
  if (c.kind === "text")
    return { id: e.id, icon: NotebookPen, text: c.text, quoted: true, detail: "Text", pending };
  if (c.kind === "link")
    return { id: e.id, icon: Link2, text: shortUrl(c.url), quoted: false, detail: "Link", pending };
  if (c.kind === "audio") {
    const length = c.durationMs ? ` · ${formatDuration(c.durationMs)}` : "";
    return { id: e.id, icon: Mic, text: "Voice memo", quoted: false, detail: `Voice${length}`, pending };
  }
  return {
    id: e.id,
    icon: c.kind === "image" ? ImageIcon : FileText,
    text: c.fileName,
    quoted: false,
    detail: c.kind === "image" ? "Photo" : "File",
    pending,
  };
}

/** "You asked" / "You added": the filters as chips (the first one only), then the inputs, on tint. */
export function AskedBand({
  title,
  meta,
  words,
  lines,
  onRetry,
  onDiscard,
  testId,
}: {
  title: string;
  meta: string;
  words?: string[];
  lines: InputLine[];
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  testId?: string;
}) {
  return (
    <Band tone="tint" className="px-5 pt-4 pb-4" data-testid={testId}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="display text-[22px]">{title}</h2>
        <Label className="text-muted-foreground">{meta}</Label>
      </div>
      {words && words.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-0.5" aria-label="Filters" data-testid="asked-filters">
          {words.map((w) => (
            <li key={w} className="bg-background px-2.5 py-1.5 font-bold text-[13px]">
              {w}
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="asked-inputs">
          {lines.map((l) => (
            <li key={l.id} className="font-medium text-[15px] leading-snug" data-testid="asked-input">
              <span className="flex items-start gap-2.5">
                <l.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                <span className="min-w-0 break-words">
                  {l.quoted ? `“${l.text}”` : l.text}
                  <span className="text-muted-foreground"> · {l.detail}</span>
                  {l.pending && !l.pending.refused && (
                    <span className="text-muted-foreground"> · {l.pending.label}</span>
                  )}
                </span>
              </span>
              {l.pending?.refused && (
                <span className="mt-1.5 flex items-center gap-2 bg-orange py-1 pr-1 pl-3 text-orange-foreground">
                  <span className="min-w-0 flex-1 font-bold text-sm">{l.pending.label}</span>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={() => onRetry(l.id)}
                      className="h-11 px-2 font-bold text-sm underline underline-offset-4"
                    >
                      Retry
                    </button>
                  )}
                  {onDiscard && (
                    <button
                      type="button"
                      onClick={() => onDiscard(l.id)}
                      className="h-11 px-2 font-bold text-sm underline underline-offset-4"
                    >
                      Discard
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Band>
  );
}

/** The kcal column of a row: a number, or a muted "—" while there is none. */
function KcalColumn({ kcal, muted }: { kcal: number | null; muted?: boolean }) {
  return (
    <div className={cn("shrink-0 text-right", muted && "text-muted-foreground")}>
      <div className="display text-[28px]">{kcal === null ? "—" : formatNumber(kcal)}</div>
      <Label className="text-[10px] text-muted-foreground">{kcal === null ? "kcal" : "kcal / portion"}</Label>
    </div>
  );
}

const sourceIcon: Record<PlanningSuggestionView["sourceMode"], LucideIcon> = {
  published: Globe,
  adapted: Globe,
  composed: Sparkles,
};

const MACROS = [
  ["protein", "P"],
  ["fat", "F"],
  ["carbohydrate", "C"],
  ["fiber", "Fi"],
] as const;

/**
 * A ready suggestion as a full-width band: title and kcal per portion, its day's bar with the dish,
 * where that lands, the macros and the protein open, two why-lines, time and source; **Pick ·
 * Wed dinner** (the foreground fill, not lime: picking is available, the screen doesn't need it)
 * and No. A rejected one folds into a line with Undo; a picked one turns tint with Change day ·
 * portions (the Plan-for sheet) and Unplan. The title opens the recipe.
 */
export function SuggestionBand({
  s,
  request,
  days,
  today,
  onOpen,
  onChange,
}: {
  s: PlanningSuggestionView;
  request: PlanningRequest;
  days: readonly PlanDay[] | undefined;
  today: string;
  onOpen: () => void;
  onChange: (plannedMealId: string) => void;
}) {
  const pick = usePickSuggestion(request.id);
  const reject = useRejectSuggestion(request.id);
  const unplan = useUnplanMeal();
  // one id per band: a retry after a lost answer is answered with the same planned meal
  const [pickId] = useState(() => uuidv7());
  const busy = pick.isPending || reject.isPending || unplan.isPending;
  const error = pick.error ?? reject.error ?? unplan.error;
  const recipe = s.recipe;
  const per = s.perPortion?.nutrients ?? null;
  const fit = s.fit;

  if (s.verdict === "rejected") {
    return (
      <li
        className="flex min-h-12 items-center gap-3 px-5 text-muted-foreground"
        data-testid="suggestion"
        data-state="rejected"
      >
        <X className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{s.title} · no</span>
        <button
          type="button"
          onClick={() => reject.mutate({ suggestionId: s.id, reject: false })}
          disabled={busy}
          className="h-11 px-1 font-bold text-foreground text-sm underline underline-offset-4"
        >
          Undo
        </button>
      </li>
    );
  }

  const picked = s.verdict === "picked" && s.plannedMealId;
  const target = picked && fit ? { date: fit.date, slot: fit.slot } : pickTarget(s, request, days, today);
  const kcalTarget = fit?.goal?.targets.energyKcal ?? null;
  const before = fit?.before?.nutrients;
  const withKcal = fit?.with.nutrients.energyKcal ?? null;
  const proteinTarget = fit?.goal?.targets.protein ?? null;
  const proteinOpen = proteinTarget === null ? null : Math.max(0, proteinTarget - (before?.protein ?? 0));
  const SourceIcon = sourceIcon[s.sourceMode];

  return (
    <li
      className={cn("px-5 pt-4 pb-4", picked && "bg-tint")}
      data-testid="suggestion"
      data-state={picked ? "picked" : "ready"}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-4 text-left outline-none focus-visible:underline"
      >
        <div className="min-w-0 flex-1">
          {picked && (
            <Label className="mb-1.5 flex items-center gap-1.5">
              <ChefHat className="size-3.5" strokeWidth={2.5} /> Planned · {slotWords(target, today)}
            </Label>
          )}
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em]" data-testid="suggestion-title">
            {s.title}
          </h3>
          <p className="mt-1.5 font-medium text-muted-foreground text-sm leading-snug">
            {recipe?.summary || s.approach}
          </p>
        </div>
        <KcalColumn kcal={per?.energyKcal ?? null} />
      </button>
      {fit && kcalTarget !== null && withKcal !== null && (
        <>
          <FitBar
            base={before?.energyKcal ?? 0}
            dish={Math.max(0, withKcal - (before?.energyKcal ?? 0))}
            target={kcalTarget}
            surface={picked ? "tint" : "page"}
            className="mt-3"
          />
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <Label className="text-muted-foreground">{slotWords(fit, today).split(" ")[0]} with it</Label>
            <span className="font-bold text-sm" data-testid="suggestion-fit">
              {formatNumber(withKcal)} of {formatNumber(kcalTarget)} ·{" "}
              {kcalTarget - withKcal < 0
                ? `${formatNumber(withKcal - kcalTarget)} over`
                : `${formatNumber(kcalTarget - withKcal)} left`}
            </span>
          </div>
        </>
      )}
      {per && (
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="flex gap-0.5">
            {MACROS.map(([k, short]) => (
              <span
                key={k}
                className={cn("px-1.5 py-1 font-bold text-[13px]", picked ? "bg-background" : "bg-tint")}
              >
                {formatNumber(per[k])}
                <span className="ml-0.5 font-bold text-[10px] text-muted-foreground uppercase">
                  g {short}
                </span>
              </span>
            ))}
          </span>
          {proteinOpen !== null && (
            <span className="shrink-0 font-bold text-sm">
              {formatNumber(per.protein)}{" "}
              <span className="text-muted-foreground">of {formatNumber(proteinOpen)} g P open</span>
            </span>
          )}
        </div>
      )}
      {s.why.length > 0 && (
        <ul className="mt-3 space-y-1">
          {s.why.slice(0, 2).map((w) => (
            <li key={w} className="flex items-start gap-2 font-medium text-[15px] leading-snug">
              <Square className="mt-1.5 size-2 shrink-0 fill-current" strokeWidth={0} />
              {w}
            </li>
          ))}
        </ul>
      )}
      <Label className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {recipe && (recipe.timeTotalMin !== null || recipe.timeActiveMin !== null) && (
          <>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" strokeWidth={2.5} />
              {[
                recipe.timeActiveMin !== null ? `${recipe.timeActiveMin} min active` : "",
                recipe.timeTotalMin !== null ? `${recipe.timeTotalMin} total` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span>·</span>
          </>
        )}
        <span className="inline-flex items-center gap-1">
          <SourceIcon className="size-3.5" strokeWidth={2.5} />
          {recipe ? sourceLabel(recipe) : MODE_LABEL[s.sourceMode].title}
        </span>
      </Label>
      {error && (
        <p className="mt-3 bg-orange px-3 py-2 font-bold text-orange-foreground text-sm" role="alert">
          {planError(error, "picking")}
        </p>
      )}
      {picked ? (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={() => s.plannedMealId && onChange(s.plannedMealId)}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-background font-bold text-sm uppercase tracking-[0.08em] outline-none active:opacity-70 focus-visible:underline"
            data-testid="change-pick"
          >
            <CalendarClock className="size-5" strokeWidth={2.5} /> Change day · portions
          </button>
          <button
            type="button"
            onClick={() => s.plannedMealId && unplan.mutate(s.plannedMealId)}
            disabled={busy}
            className="flex h-11 w-24 items-center justify-center bg-background font-bold text-sm uppercase tracking-[0.08em] outline-none active:opacity-70 focus-visible:underline"
            data-testid="unplan-pick"
          >
            {unplan.isPending ? "…" : "Unplan"}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-0.5">
          <button
            type="button"
            onClick={() => pick.mutate({ suggestionId: s.id, body: { id: pickId } })}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center gap-2 bg-ink font-bold text-ink-foreground text-sm uppercase tracking-[0.08em] outline-none active:opacity-80 focus-visible:underline disabled:opacity-60"
            data-testid="pick"
          >
            <Check className="size-5" strokeWidth={3} />{" "}
            {pick.isPending ? "Picking…" : `Pick · ${slotWords(target, today)}`}
          </button>
          <button
            type="button"
            onClick={() => reject.mutate({ suggestionId: s.id, reject: true })}
            disabled={busy}
            className="flex h-11 w-24 items-center justify-center gap-2 bg-tint font-bold text-sm uppercase tracking-[0.08em] outline-none active:opacity-70 focus-visible:underline"
            aria-label={`No: ${s.title}`}
            data-testid="reject"
          >
            <X className="size-5" strokeWidth={2.5} /> No
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * An outlined idea, before the agent completes it: title, approach, a grey bar, its state
 * ("Checking ingredients…" for the one being worked on, else "Queued"), the source mode and the
 * proposed slot. Quiet.
 */
export function OutlineRow({
  s,
  working,
  today,
}: {
  s: PlanningSuggestionView;
  working: boolean;
  today: string;
}) {
  return (
    <li className="px-5 pt-4 pb-4 text-muted-foreground" data-testid="suggestion" data-state="outlined">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em]">{s.title}</h3>
          <p className="mt-1.5 font-medium text-sm leading-snug">{s.approach}</p>
        </div>
        <KcalColumn kcal={null} muted />
      </div>
      <div className="mt-3 h-3 w-full bg-foreground/8" aria-hidden />
      <Label className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          {working && <span className="size-2 animate-pulse bg-current" />}
          {working ? "Checking ingredients…" : "Queued"}
        </span>
        <span>·</span>
        <span>{MODE_LABEL[s.sourceMode].short}</span>
        {s.proposedDate && s.proposedSlot && (
          <span className="ml-auto">{slotWords({ date: s.proposedDate, slot: s.proposedSlot }, today)}</span>
        )}
      </Label>
    </li>
  );
}

/** The server's "didn't complete" (the round ended first) in words; the agent's own reasons as they are. */
const failureText = (f: string | null): string =>
  !f ? "No reason given." : f === "didn't complete" ? "The round ended before this idea was done." : f;

/**
 * An idea the agent couldn't complete: struck through, quiet, the reason in its words (no orange:
 * the round still worked; Suggest more is the retry).
 */
export function FailedRow({ s }: { s: PlanningSuggestionView }) {
  return (
    <li className="px-5 pt-4 pb-4" data-testid="suggestion" data-state="failed">
      <div className="flex items-start gap-4 text-muted-foreground">
        <div className="min-w-0 flex-1">
          <h3 className="display text-[22px] leading-[1.0] tracking-[-0.03em] line-through decoration-2">
            {s.title}
          </h3>
          <p className="mt-1.5 font-medium text-sm leading-snug">{s.approach}</p>
        </div>
        <KcalColumn kcal={null} muted />
      </div>
      <p className="mt-3 flex items-start gap-2 font-medium text-[15px] leading-snug">
        <Square className="mt-1.5 size-2 shrink-0" strokeWidth={3} />
        <span>
          <b className="font-bold">Couldn't complete.</b> {failureText(s.failure)}
        </span>
      </p>
    </li>
  );
}

/** A round's rows: ready bands, outlined placeholders (the first one being worked on), failed ideas. */
export function RoundRows({
  round,
  request,
  days,
  today,
  onOpen,
  onChange,
}: {
  round: PlanningRoundView;
  request: PlanningRequest;
  days: readonly PlanDay[] | undefined;
  today: string;
  onOpen: (s: PlanningSuggestionView) => void;
  onChange: (plannedMealId: string) => void;
}) {
  const working =
    round.status === "running" ? round.suggestions.find((s) => s.status === "outlined")?.id : undefined;
  return (
    <ul className="divide-y divide-border" data-testid="round-rows">
      {round.suggestions.map((s) =>
        s.status === "ready" ? (
          <SuggestionBand
            key={s.id}
            s={s}
            request={request}
            days={days}
            today={today}
            onOpen={() => onOpen(s)}
            onChange={onChange}
          />
        ) : s.status === "outlined" ? (
          round.status === "failed" ? (
            <FailedRow key={s.id} s={{ ...s, failure: s.failure ?? round.error }} />
          ) : (
            <OutlineRow key={s.id} s={s} working={s.id === working} today={today} />
          )
        ) : (
          <FailedRow key={s.id} s={s} />
        ),
      )}
    </ul>
  );
}

/* ------------------------------------------------------------- the overview */

/** How an open request stands, for the overview's Planning strip; null when it wants nothing. */
export function requestState(
  r: PlanningRequestSummary,
): { kind: "waiting" | "suggesting" | "failed" | "added"; label: string; count: number } | null {
  const round = r.latestRound;
  if (!round)
    return r.pendingInputs > 0 || r.inputs > 0 ? { kind: "suggesting", label: "Queued", count: 0 } : null;
  if (round.status === "queued" || round.status === "running") {
    const done = round.ready + round.failed;
    return {
      kind: "suggesting",
      label:
        round.status === "queued" && done === 0
          ? "Queued"
          : `Suggesting · ${round.ready} of ${round.count} ready`,
      count: round.ready,
    };
  }
  if (round.status === "failed") return { kind: "failed", label: "Failed", count: 0 };
  const open = round.ready - round.picked - round.rejected;
  if (open > 0) return { kind: "waiting", label: `Suggested · ${open} for you`, count: open };
  if (r.pendingInputs > 0)
    return { kind: "added", label: `${plural(r.pendingInputs, "addition")} · suggest with it`, count: 0 };
  return null;
}

/**
 * The overview's Planning strip, under the totals: requests whose suggestions wait for a verdict
 * (lime, like a meal that needs input), still suggesting ("2 of 3 ready", quiet), failed (orange,
 * like a failed meal), and requests still on this phone (quiet). Nothing when nothing wants
 * attention.
 */
export function PlanningStrip({
  requests,
  queued,
}: {
  requests: readonly PlanningRequestSummary[];
  /** Requests made on this phone the server doesn't have yet. */
  queued: readonly { requestId: string; title: string; refused: boolean }[];
}) {
  const rows = requests.flatMap((r) => {
    const state = requestState(r);
    return state ? [{ r, state }] : [];
  });
  if (rows.length === 0 && queued.length === 0) return null;
  return (
    <section aria-label="Planning" data-testid="planning-strip">
      <Strip title="Planning" meta={plural(rows.length + queued.length, "request")} />
      <ul className="divide-y divide-border">
        {queued.map((q) => (
          <li key={q.requestId} className={cn(q.refused && "bg-orange text-orange-foreground")}>
            <Link
              to="/plan/requests/$id"
              params={{ id: q.requestId }}
              className="flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 outline-none active:opacity-80 focus-visible:underline"
              data-testid="planning-row"
              data-state={q.refused ? "refused" : "queued"}
            >
              <div className="min-w-0 flex-1">
                <Label className={cn("flex items-center gap-2", !q.refused && "text-muted-foreground")}>
                  {q.refused ? "Not sent" : "On this phone · waiting to send"}
                </Label>
                <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">{q.title}</div>
              </div>
              <div className="flex shrink-0 items-center">
                <ArrowRight className="size-6" strokeWidth={2.5} />
              </div>
            </Link>
          </li>
        ))}
        {rows.map(({ r, state }) => {
          const loud = state.kind === "waiting" || state.kind === "added";
          const failed = state.kind === "failed";
          return (
            <li
              key={r.request.id}
              className={cn(
                loud && "bg-lime text-lime-foreground",
                failed && "bg-orange text-orange-foreground",
              )}
            >
              <Link
                to="/plan/requests/$id"
                params={{ id: r.request.id }}
                className={cn(
                  "flex min-h-[84px] w-full items-stretch gap-4 px-5 py-3 outline-none active:opacity-80 focus-visible:underline",
                  state.kind === "suggesting" && "text-muted-foreground",
                )}
                data-testid="planning-row"
                data-state={state.kind}
              >
                <div className="min-w-0 flex-1">
                  <Label className="flex items-center gap-2">
                    {state.kind === "suggesting" ? (
                      <span className="size-2 animate-pulse bg-current" />
                    ) : (
                      <Sparkles className="size-3.5" strokeWidth={2.5} />
                    )}
                    {state.label}
                  </Label>
                  <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
                    {r.request.title}
                  </div>
                  <div className={cn("mt-1.5 font-medium text-xs", loud && "text-lime-muted")}>
                    {state.kind === "failed"
                      ? "No suggestions this time. Open it to see why, or ask again."
                      : state.kind === "waiting"
                        ? `Pick or steer · round ${r.latestRound?.number ?? 1} · ${formatTime(r.request.updatedAt)}`
                        : state.kind === "added"
                          ? "Your additions wait for a round."
                          : `Round ${r.latestRound?.number ?? 1} · started ${formatTime(r.request.updatedAt)}`}
                  </div>
                </div>
                {state.kind === "suggesting" && r.latestRound ? (
                  <div className="shrink-0 text-right">
                    <div className="display text-[26px]">{state.count}</div>
                    <Label className="text-[10px]">of {r.latestRound.count}</Label>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center">
                    <ArrowRight className="size-6" strokeWidth={2.5} />
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
