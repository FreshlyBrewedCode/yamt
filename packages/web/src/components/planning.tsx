// Planning on the phone (#40, direction G of spike #37): the quiet planned-meal row with its Ate-it
// square, the split Log | Plan slab, the totals slab's "with it" note, how a dish fits its day, and
// the two top sheets: "Ate it" (log a planned meal without a model) and "Plan for" (move it,
// re-portion it, skip or unplan it).
import { Link } from "@tanstack/react-router";
import {
  addDays,
  type LogPlannedMealResponse,
  type MealSlot,
  type PlanDay,
  type PlannedMealView,
} from "@yamt/shared";
import { cn } from "cn";
import { Check, ChefHat, Clock, Plus, SkipForward, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dateStart,
  dayLabel,
  formatGrams,
  formatNumber,
  formatWeekday,
  fromLocalInput,
  localDate,
  toLocalInput,
} from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import {
  ateItTotals,
  defaultEatenAt,
  gramsFor,
  type Macro,
  nextDays,
  PLAN_DAYS,
  SLOT_NAME,
  SLOTS,
  slotTaken,
  withPlanned,
  withValue,
} from "@/lib/planning";
import {
  planError,
  useLogPlannedMeal,
  usePlan,
  useRecipe,
  useSkipPlannedMeal,
  useUnplanMeal,
  useUpdatePlannedMeal,
} from "@/lib/queries";
import { CaptureSheet } from "./add-strip";
import { CheckSquare, type ChipOption, Chips } from "./choice";
import { BottomSlab, Label, SlabButton } from "./slab";

/** "Today, dinner" / "Wed 5 Nov, lunch": when a planned meal is, in words. */
export const whenWords = (p: Pick<PlannedMealView, "date" | "slot">, now = Date.now()): string =>
  `${dayLabel(dateStart(p.date), now)}, ${SLOT_NAME[p.slot].toLowerCase()}`;

/** "1.5" portions, "0.5", "2". */
export const portions = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * The overview's bottom slab (#40): **Log** (lime, the meal capture) | **Plan** (tint: it doesn't
 * want the user; the totals slab stays the screen's ink).
 */
export function SplitSlab({ onLog, onPlan }: { onLog: () => void; onPlan: () => void }) {
  return (
    <BottomSlab>
      <div className="flex">
        <SlabButton className="h-full flex-1" onClick={onLog} aria-label="Log meal">
          <Plus className="size-8" strokeWidth={3} /> Log
        </SlabButton>
        <SlabButton tone="tint" className="h-full w-[42%]" onClick={onPlan} data-testid="plan-button">
          <ChefHat className="size-7" strokeWidth={2.5} /> Plan
        </SlabButton>
      </div>
    </BottomSlab>
  );
}

/**
 * A planned meal in a list: quiet (muted title, "Planned · Dinner", the kcal marked "planned"); a
 * tap opens its recipe. With `onAte`, a 64 px tint Ate-it square on the right opens the sheet.
 * Logged ones say so with their meal's kcal, skipped ones count nothing.
 */
export function PlannedRow({
  planned,
  onAte,
  loggedKcal,
  className,
}: {
  planned: PlannedMealView;
  onAte?: () => void;
  /** The logged meal's kcal (it may have left items out). */
  loggedKcal?: number | null;
  className?: string;
}) {
  const status = planned.status;
  const label =
    status === "logged"
      ? `Logged · ${SLOT_NAME[planned.slot]}`
      : status === "skipped"
        ? `Skipped · ${SLOT_NAME[planned.slot]}`
        : `Planned · ${SLOT_NAME[planned.slot]}`;
  const kcal =
    status === "logged"
      ? (loggedKcal ?? planned.eaten.nutrients.energyKcal)
      : planned.eaten.nutrients.energyKcal;
  return (
    <li
      className={cn("flex min-h-[84px] items-stretch", className)}
      data-testid="planned-row"
      data-status={status}
    >
      <Link
        to="/planned/$id"
        params={{ id: planned.id }}
        className="flex min-w-0 flex-1 items-stretch gap-4 px-5 py-3 outline-none active:bg-tint focus-visible:ring-4 focus-visible:ring-foreground/30 focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1">
          <Label className="flex items-center gap-2 text-muted-foreground">
            {status === "logged" ? (
              <Check className="size-3.5 shrink-0" strokeWidth={3} />
            ) : (
              <ChefHat className="size-3.5 shrink-0" strokeWidth={2.5} />
            )}
            {label}
          </Label>
          <div
            className={cn(
              "display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]",
              status === "logged" ? "" : "text-muted-foreground",
              status === "skipped" && "line-through",
            )}
          >
            {planned.title}
          </div>
          <div className="mt-1.5 font-medium text-muted-foreground text-xs">
            {status === "skipped"
              ? "Not counted"
              : `Cook ${planned.portionsCooked} · eat ${portions(planned.portionEaten)}`}
          </div>
        </div>
        <div className={cn("shrink-0 text-right", status !== "logged" && "text-muted-foreground")}>
          <div className={cn("display text-[26px]", status === "skipped" && "opacity-40")}>
            {formatNumber(kcal)}
          </div>
          <Label className="text-[10px] text-muted-foreground">
            {status === "planned" ? "planned" : status === "logged" ? "kcal" : "skipped"}
          </Label>
        </div>
      </Link>
      {onAte && (
        <button
          type="button"
          onClick={onAte}
          aria-label={`Ate it: ${planned.title}`}
          className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-tint outline-none active:bg-lime active:text-lime-foreground focus-visible:underline"
          data-testid="ate-it-square"
        >
          <Check className="size-6" strokeWidth={2.5} />
          <Label className="text-[10px]">Ate it</Label>
        </button>
      )}
    </li>
  );
}

/** "1 planned · with it 1,971 of 2,200 · 229 left" for the totals slab's note. */
export function PlannedNote({ day }: { day: PlanDay | undefined }) {
  const w = withPlanned(day);
  if (!w) return null;
  return (
    <span className="flex items-center gap-2" data-testid="planned-note">
      <ChefHat className="size-3.5 shrink-0" strokeWidth={2.5} />
      {w.planned} planned · with it {formatNumber(w.kcal)}
      {w.target !== null ? ` of ${formatNumber(w.target)}` : " kcal"}
      {w.left !== null &&
        (w.left < 0 ? ` · ${formatNumber(-w.left)} over` : ` · ${formatNumber(w.left)} left`)}
    </span>
  );
}

/**
 * How a dish fits its day: lime = what the day already holds (eaten and planned), the foreground =
 * this dish, a 2 px gap where the target is and the excess after it in the foreground at 60 %.
 * Never red. On the ink slab by default; `surface` "page" or "tint" for a suggestion band (#47),
 * whose gap takes the band's own colour.
 */
export function FitBar({
  base,
  dish,
  target,
  surface = "ink",
  className,
}: {
  base: number;
  dish: number;
  target: number;
  surface?: "ink" | "page" | "tint";
  className?: string;
}) {
  const total = base + dish;
  const scale = Math.max(total, target, 1);
  const pct = (x: number) => `${(x / scale) * 100}%`;
  const baseW = Math.min(base, target);
  const dishW = Math.max(0, Math.min(total, target) - baseW);
  const over = Math.max(0, total - target);
  const ink = surface === "ink";
  return (
    <div
      className={cn("flex h-3 w-full", ink ? "bg-ink-line" : "bg-foreground/10", className)}
      role="img"
      aria-label={`${formatNumber(total)} of ${formatNumber(target)} kcal with it`}
      data-testid="fit-bar"
    >
      <div className="h-full bg-lime" style={{ width: pct(baseW) }} />
      <div
        className={cn("h-full", ink ? "bg-ink-foreground" : "bg-foreground")}
        style={{ width: pct(dishW) }}
      />
      {over > 0 && (
        <>
          <div
            className={cn(
              "h-full w-0.5 shrink-0",
              ink ? "bg-ink" : surface === "tint" ? "bg-tint" : "bg-background",
            )}
          />
          <div
            className={cn("h-full", ink ? "bg-ink-foreground/60" : "bg-foreground/60")}
            style={{ width: pct(over) }}
          />
        </>
      )}
    </div>
  );
}

const GRID: readonly [Exclude<Macro, "energyKcal">, string][] = [
  ["protein", "Prot"],
  ["fat", "Fat"],
  ["carbohydrate", "Carb"],
  ["fiber", "Fibre"],
];

/** The dish's macros on the ink slab, each against what is open of its target ("30 /82"). */
export function OpenGrid({
  dish,
  open,
  className,
}: {
  dish: Record<Macro, number>;
  open: Record<Macro, number | null>;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-4 gap-3", className)}>
      {GRID.map(([k, short]) => {
        const o = open[k];
        const v = dish[k];
        return (
          <div key={k} data-testid={`dish-${k}`}>
            <div className="flex items-baseline gap-0.5">
              <span className="display text-[24px]">{formatNumber(v)}</span>
              <span className="font-bold text-ink-muted text-xs">
                {o !== null ? `/${formatNumber(Math.max(0, o))}` : "g"}
              </span>
            </div>
            {o !== null && (
              <div className="mt-1.5 flex h-1.5 bg-ink-line">
                <div
                  className="h-full bg-lime"
                  style={{ width: `${Math.min(100, (v / Math.max(o, 1)) * 100)}%` }}
                />
              </div>
            )}
            <Label className="mt-1.5 text-ink-muted">{short}</Label>
          </div>
        );
      })}
    </div>
  );
}

/** The time a meal was eaten: "Now · change time", or a `datetime-local` once tapped (or preset). */
function WhenField({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => onChange(toLocalInput(Date.now()))}
        className="-ml-1 flex min-h-11 items-center gap-2 px-1 font-bold text-sm outline-none focus-visible:underline"
      >
        <Clock className="size-4" strokeWidth={2.5} /> Now · change time
      </button>
    );
  }
  return (
    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-bold text-sm">
      <Clock className="size-4 shrink-0" strokeWidth={2.5} />
      <input
        type="datetime-local"
        value={value}
        max={toLocalInput(Date.now())}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Eaten at"
        className="h-11 min-w-0 flex-1 bg-tint px-2 outline-none focus:bg-lime-soft"
      />
    </label>
  );
}

const ATE_PORTIONS: ChipOption<number>[] = [
  { value: 0.5, label: "Half", sub: "0.5×" },
  { value: 1, label: "As planned", sub: "1×" },
  { value: 1.5, label: "More", sub: "1.5×" },
  { value: 2, label: "Double", sub: "2×" },
];

/** The sheet's height cap: a recipe's ingredients can be longer than the screen. */
const TALL_SHEET = "max-h-dvh overflow-y-auto overscroll-contain";

/**
 * "Ate it" (#40): the planned meal's ingredients as check rows (all on; switch off what was left
 * out), the portion relative to the plan ("of 2 cooked"), the time, and the kcal and macros of what
 * will be logged, computed with the shared totals; lime **Log it** posts it (one request, never
 * queued) and `onLogged` opens the new meal. `planned` null closes it.
 */
export function AteItSheet({
  planned,
  onClose,
  onLogged,
}: {
  planned: PlannedMealView | null;
  onClose: () => void;
  onLogged: (r: LogPlannedMealResponse) => void;
}) {
  // kept while the sheet slides out, so its content doesn't vanish first
  const [shown, setShown] = useState<PlannedMealView | null>(planned);
  if (planned && planned !== shown) setShown(planned);
  return (
    <CaptureSheet
      open={planned !== null}
      onClose={onClose}
      title={shown?.title ?? ""}
      description={shown ? `Ate it · ${whenWords(shown)}` : "Ate it"}
      className={TALL_SHEET}
    >
      {shown && (
        <AteItForm key={`${shown.id}-${planned ? "open" : "closed"}`} planned={shown} onLogged={onLogged} />
      )}
    </CaptureSheet>
  );
}

function AteItForm({
  planned,
  onLogged,
}: {
  planned: PlannedMealView;
  onLogged: (r: LogPlannedMealResponse) => void;
}) {
  const recipe = useRecipe(planned.recipeId);
  const [without, setWithout] = useState<ReadonlySet<string>>(new Set());
  const [factor, setFactor] = useState(1);
  // an earlier day's meal starts at the slot's usual hour on that day, today's at now
  const [when, setWhen] = useState<string | null>(() => {
    const at = defaultEatenAt(planned.date, planned.slot, Date.now());
    return planned.date < localDate(Date.now()) ? toLocalInput(at) : null;
  });
  // one id per opening: a retry after a lost response answers the same meal
  const [id] = useState(() => uuidv7());
  const log = useLogPlannedMeal();
  const at = when === null ? null : fromLocalInput(when);
  const eat = Math.min(10, Math.max(0.1, Math.round(planned.portionEaten * factor * 100) / 100));
  const data = recipe.data;

  if (!data) {
    return (
      <p className="px-5 pb-6 font-medium text-muted-foreground">
        {recipe.isError ? planError(recipe.error, "reading the recipe") : "Loading…"}
      </p>
    );
  }
  const totals = ateItTotals(data.recipe, data.items, eat, without);
  const n = totals.nutrients;
  const nothing = without.size >= data.items.length;
  const left = planned.portionsCooked - eat;
  const toggle = (itemId: string) => {
    const next = new Set(without);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setWithout(next);
  };
  const submit = () => {
    if (log.isPending || nothing || (when !== null && at === null)) return;
    log.mutate(
      {
        plannedMealId: planned.id,
        body: { id, eatenAt: at ?? Date.now(), portionEaten: eat, excludeItemIds: [...without] },
      },
      { onSuccess: onLogged },
    );
  };

  return (
    <div data-testid="ate-it">
      <p className="px-5 pb-3 font-medium text-muted-foreground text-sm">
        Logged as a meal with these items, scaled to the portion: no analysis. Switch off what you left out.
      </p>
      <ul className="divide-y divide-border border-border border-y">
        {data.items.map((i) => {
          const on = !without.has(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i.id)}
                className="flex min-h-12 w-full items-center gap-3 px-5 py-2 text-left outline-none focus-visible:bg-tint"
                data-testid="ate-it-item"
              >
                <CheckSquare on={on} />
                <span
                  className={cn(
                    "min-w-0 flex-1 font-bold text-[15px] leading-snug",
                    !on && "text-muted-foreground line-through",
                  )}
                >
                  {i.description}
                  {i.optional && (
                    <span className="ml-2 font-medium text-muted-foreground text-xs">optional</span>
                  )}
                </span>
                <span className={cn("display shrink-0 text-[18px]", !on && "text-muted-foreground")}>
                  {formatGrams(gramsFor(data.recipe, i, eat))}
                  <span className="font-bold text-muted-foreground text-xs">g</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-5 pt-4 pb-5">
        <Label className="mb-2 text-muted-foreground">
          Portion{planned.portionsCooked > 1 ? ` · of ${planned.portionsCooked} cooked` : ""}
        </Label>
        <Chips label="Portion" options={ATE_PORTIONS} value={factor} onChange={setFactor} />
        {left > 0 && (
          <p className="mt-2 font-medium text-muted-foreground text-sm" data-testid="ate-it-leftover">
            {portions(left)} {left === 1 ? "portion stays" : "portions stay"} a leftover.
          </p>
        )}
        <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
          <WhenField value={when} onChange={setWhen} />
          <div className="shrink-0 text-right" data-testid="ate-it-kcal">
            <span className="display text-[28px]">{formatNumber(n.energyKcal)}</span>
            <Label className="text-[10px] text-muted-foreground">kcal</Label>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 font-bold text-sm" data-testid="ate-it-macros">
          {GRID.map(([k, short]) => (
            <span key={k}>
              {formatNumber(n[k])}
              <span className="ml-0.5 text-[10px] text-muted-foreground uppercase">g {short}</span>
            </span>
          ))}
        </div>
      </div>
      {log.isError && (
        <Label
          className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
          role="alert"
        >
          {planError(log.error, "logging from the plan")}
        </Label>
      )}
      {nothing && (
        <Label className="bg-tint px-5 py-2.5 text-center text-muted-foreground normal-case tracking-normal">
          Switch at least one ingredient on.
        </Label>
      )}
      <SlabButton
        onClick={submit}
        disabled={log.isPending || nothing || (when !== null && at === null)}
        className="h-[calc(64px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]"
      >
        <Check className="size-7" strokeWidth={3} /> {log.isPending ? "Logging…" : "Log it"}
      </SlabButton>
    </div>
  );
}

const COOK = [1, 2, 3, 4];
const EAT = [0.5, 1, 1.5, 2];

/** Cook / Eat portion chips side by side; the planned meal's own value joins when it is no preset. */
export function PortionChips({
  cook,
  eat,
  onChange,
  disabled = false,
  eatLabel = "Eat",
}: {
  cook: number;
  eat: number;
  onChange: (v: { cook: number; eat: number }) => void;
  disabled?: boolean;
  eatLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <div>
        <Label className="mb-2 text-muted-foreground">Cook</Label>
        <Chips
          label="Portions to cook"
          options={withValue(COOK, cook).map((p) => ({ value: p, label: "", sub: String(p) }))}
          value={cook}
          disabled={disabled}
          onChange={(c) => onChange({ cook: c, eat: Math.min(eat, c) })}
        />
      </div>
      <div>
        <Label className="mb-2 text-muted-foreground">{eatLabel}</Label>
        <Chips
          label="Portion to eat"
          options={withValue(EAT, eat).map((p) => ({ value: p, label: "", sub: `${portions(p)}×` }))}
          value={eat}
          disabled={disabled}
          onChange={(e) => onChange({ cook: Math.max(cook, Math.ceil(e)), eat: e })}
        />
      </div>
    </div>
  );
}

/**
 * "Plan for" (#40): change a planned meal's day (the next seven days as chips), slot and portions;
 * warns when the slot already holds a meal (allowed: both stay planned) and shows the day with it.
 * Skip and Unplan below. Only for a meal still `planned`.
 */
export function PlanForSheet({
  planned,
  open,
  onClose,
  onUnplanned,
}: {
  planned: PlannedMealView;
  open: boolean;
  onClose: () => void;
  onUnplanned: () => void;
}) {
  return (
    <CaptureSheet
      open={open}
      onClose={onClose}
      title={planned.title}
      description="Plan for"
      className={TALL_SHEET}
    >
      {/* kept while the sheet slides out (a fresh form every time it opens) */}
      <PlanForForm
        key={open ? "open" : "closed"}
        planned={planned}
        onDone={onClose}
        onUnplanned={onUnplanned}
      />
    </CaptureSheet>
  );
}

function PlanForForm({
  planned,
  onDone,
  onUnplanned,
}: {
  planned: PlannedMealView;
  onDone: () => void;
  onUnplanned: () => void;
}) {
  const now = Date.now();
  const today = localDate(now);
  const days = nextDays(today);
  // a meal planned before today or beyond the week keeps its own day as a chip
  if (!days.includes(planned.date)) {
    if (planned.date < today) days.unshift(planned.date);
    else days.push(planned.date);
  }
  // the days on the chips, at most a month per request (further out, the sheet reads the week only)
  const wide = dateStart(days.at(-1)!) - dateStart(days[0]!) <= 30 * 86_400_000;
  const plan = usePlan(wide ? days[0]! : today, wide ? days.at(-1)! : addDays(today, PLAN_DAYS - 1));
  const [date, setDate] = useState(planned.date);
  const [slot, setSlot] = useState<MealSlot>(planned.slot);
  const [p, setP] = useState({ cook: planned.portionsCooked, eat: planned.portionEaten });
  const [confirm, setConfirm] = useState(false);
  const update = useUpdatePlannedMeal();
  const skip = useSkipPlannedMeal();
  const unplan = useUnplanMeal();
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const day = plan.data?.days.find((d) => d.date === date);
  const taken = slotTaken(day, slot, planned.id);
  const perPortion = planned.perPortion.nutrients.energyKcal;
  const dish = perPortion * p.eat;
  // the day's projection without this meal (it counts there while planned), plus it as set here
  const base = Math.max(
    0,
    (day?.projected?.nutrients.energyKcal ?? 0) -
      (planned.date === date ? planned.eaten.nutrients.energyKcal : 0),
  );
  const target = day?.goal?.targets.energyKcal ?? null;
  const total = base + dish;
  const changed =
    date !== planned.date ||
    slot !== planned.slot ||
    p.cook !== planned.portionsCooked ||
    p.eat !== planned.portionEaten;
  const busy = update.isPending || skip.isPending || unplan.isPending;
  const error = update.error ?? skip.error ?? unplan.error;
  const dayWord = formatWeekday(date);

  const save = () =>
    update.mutate(
      {
        id: planned.id,
        body: {
          ...(date !== planned.date ? { date } : {}),
          ...(slot !== planned.slot ? { slot } : {}),
          ...(p.cook !== planned.portionsCooked ? { portionsCooked: p.cook } : {}),
          ...(p.eat !== planned.portionEaten ? { portionEaten: p.eat } : {}),
        },
      },
      { onSuccess: onDone },
    );

  return (
    <div data-testid="plan-for">
      <div className="px-5 pb-5">
        <Label className="mb-2 text-muted-foreground">Day</Label>
        <Chips
          label="Day"
          options={days.map((d) => ({
            value: d,
            label: d === today ? "Today" : formatWeekday(d),
            sub: String(Number(d.slice(8))),
          }))}
          value={date}
          onChange={setDate}
        />
        <Label className="mt-4 mb-2 text-muted-foreground">Slot</Label>
        <Chips
          label="Slot"
          options={SLOTS.map((s) => ({ value: s, label: SLOT_NAME[s] }))}
          value={slot}
          onChange={setSlot}
        />
        {taken.length > 0 && (
          <p className="mt-2 font-medium text-sm" role="status" data-testid="slot-taken">
            {dayLabel(dateStart(date), now)}'s {SLOT_NAME[slot].toLowerCase()} already has {taken.join(", ")}.
            Both stay planned.
          </p>
        )}
        <div className="mt-4">
          <PortionChips cook={p.cook} eat={p.eat} onChange={setP} />
        </div>
        {p.cook - p.eat > 0 && (
          <p className="mt-2 font-medium text-muted-foreground text-sm">
            {portions(p.cook - p.eat)} {p.cook - p.eat === 1 ? "portion" : "portions"} left over.
          </p>
        )}
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <Label className="text-muted-foreground">{dayLabel(dateStart(date), now)} with it</Label>
          <span className="font-bold text-sm" data-testid="plan-for-fit">
            {formatNumber(total)}
            {target !== null
              ? ` of ${formatNumber(target)} · ${target - total < 0 ? `${formatNumber(total - target)} over` : `${formatNumber(target - total)} left`}`
              : " kcal"}
          </span>
        </div>
      </div>
      {error && (
        <Label
          className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
          role="alert"
        >
          {planError(error, "changing the plan")}
        </Label>
      )}
      <SlabButton onClick={save} disabled={!changed || busy}>
        <Check className="size-7" strokeWidth={3} />{" "}
        {update.isPending ? "Saving…" : `Save · ${dayWord} ${SLOT_NAME[slot].toLowerCase()}`}
      </SlabButton>
      <div className="divide-y divide-border border-border border-b">
        <button
          type="button"
          onClick={() => skip.mutate({ id: planned.id, skip: true }, { onSuccess: onDone })}
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left outline-none active:bg-tint focus-visible:bg-tint"
          data-testid="skip"
        >
          <span>
            <span className="block font-bold uppercase tracking-[0.08em]">Skip it</span>
            <span className="block font-medium text-muted-foreground text-sm">
              Stays in the plan, counted nowhere. You can undo it.
            </span>
          </span>
          <SkipForward className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        </button>
        <div className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
          <span>
            <span className="block font-bold uppercase tracking-[0.08em]">
              {confirm ? "Unplan?" : "Unplan"}
            </span>
            <span className="block font-medium text-muted-foreground text-sm">
              {confirm ? "It leaves the plan; the recipe stays." : "Take it off the plan."}
            </span>
          </span>
          {confirm ? (
            <button
              type="button"
              onClick={() => unplan.mutate(planned.id, { onSuccess: onUnplanned })}
              disabled={busy}
              className="flex h-11 shrink-0 items-center gap-2 bg-foreground px-4 font-bold text-background text-xs uppercase tracking-[0.08em] disabled:opacity-60"
              data-testid="unplan-confirm"
            >
              <Trash2 className="size-4" strokeWidth={2.5} /> {unplan.isPending ? "Unplanning…" : "Unplan"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label="Unplan"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center text-muted-foreground"
              data-testid="unplan"
            >
              <Trash2 className="size-5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
