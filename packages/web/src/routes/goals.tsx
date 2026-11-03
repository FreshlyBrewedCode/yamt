import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type Goal,
  goalInForce,
  goalPeriods,
  guidedLabel,
  TARGET_KEYS,
  type TargetKey,
  type Targets,
  type WeightEntry,
} from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, Compass, X } from "lucide-react";
import { useState } from "react";
import { CheckSquare } from "@/components/choice";
import { GoalExplanation } from "@/components/goal-explanation";
import { BackButton, BottomSlab, Disclosure, Label, SafeBottom, SlabButton, Strip } from "@/components/slab";
import { WeightEntryBand } from "@/components/weight-entry";
import { WeightTrend } from "@/components/weight-trend";
import {
  dayLabel,
  formatGrams,
  formatKg,
  formatNumber,
  formatShortDate,
  formatTime,
  localDate,
  startOfDay,
} from "@/lib/format";
import { useDeleteWeight, useGoals, useProfile, useSaveGoal, useWeight } from "@/lib/queries";

export const Route = createFileRoute("/goals")({ component: Goals });

/** How far back the trend reaches. */
const TREND_DAYS = 42;

/**
 * Goals and weight: today's weight (the lime entry while it's missing), the trend, the weight
 * entries, then the daily targets and their history. Saving new targets is the bottom slab, only
 * there once something changed.
 */
function Goals() {
  const now = Date.now();
  const today = localDate(now);
  const from = startOfDay(now, -(TREND_DAYS - 1));
  // a week more, so the moving average is whole from the first day shown
  const weight = useWeight(startOfDay(now, -(TREND_DAYS + 6)), startOfDay(now, 1));
  const goals = useGoals();
  const entries = weight.data?.entries ?? [];
  const current = goals.data ? goalInForce(goals.data.goals, today) : null;
  // the form remounts after a save; the history stays as the user left it
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <BackButton />
        <h1 className="display mt-4 text-[36px]">Goals</h1>
      </header>

      <main className="flex-1">
        <WeightEntryBand last={entries[0] ?? null} now={now} />
        {weight.isPending ? (
          <p className="bg-tint px-5 py-6 font-medium text-muted-foreground">Loading…</p>
        ) : (
          <WeightTrend entries={entries} from={from} now={now} />
        )}
        <Disclosure
          title="Weight entries"
          meta={entries.filter((e) => e.measuredAt >= from).length || undefined}
          data-testid="weight-entries"
        >
          <WeightList entries={entries.filter((e) => e.measuredAt >= from)} now={now} />
        </Disclosure>

        {goals.isPending ? (
          <p className="px-5 py-6 font-medium text-muted-foreground">Loading…</p>
        ) : goals.isError ? (
          <p className="px-5 py-6 font-medium text-muted-foreground">Can't reach yamt right now.</p>
        ) : (
          // a fresh form whenever the goal in force changes (saved, fixed, or loaded)
          <TargetsForm
            key={`${current?.id}:${current?.updatedAt}`}
            current={current}
            history={goals.data.goals}
            today={today}
            historyOpen={historyOpen}
            onHistoryOpen={setHistoryOpen}
          />
        )}
      </main>
    </>
  );
}

function WeightList({ entries, now }: { entries: readonly WeightEntry[]; now: number }) {
  const remove = useDeleteWeight();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (entries.length === 0) {
    return <p className="bg-tint px-5 py-4 font-medium text-muted-foreground">Nothing logged yet.</p>;
  }
  return (
    <ul className="divide-y divide-border bg-tint">
      {entries.map((e) => (
        <li key={e.id} className="flex min-h-14 items-center gap-3 pl-5" data-testid="weight-row">
          <div className="min-w-0 flex-1">
            <span className="font-bold">{dayLabel(startOfDay(e.measuredAt), now)}</span>
            <span className="text-muted-foreground"> · {formatTime(e.measuredAt)}</span>
          </div>
          <div className="display text-[22px]">
            {formatKg(e.kg)}
            <span className="ml-1 font-bold text-muted-foreground text-xs">kg</span>
          </div>
          {confirm === e.id ? (
            <button
              type="button"
              onClick={() => remove.mutate(e.id, { onSettled: () => setConfirm(null) })}
              className="h-14 bg-foreground px-4 font-bold text-background text-xs uppercase tracking-[0.08em]"
            >
              Delete?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(e.id)}
              className="flex size-14 items-center justify-center text-muted-foreground"
              aria-label={`Delete ${formatKg(e.kg)} kg from ${dayLabel(startOfDay(e.measuredAt), now)}`}
            >
              <X className="size-5" strokeWidth={2.5} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const FIELDS: [TargetKey, string, string][] = [
  ["energyKcal", "Energy", "kcal"],
  ["protein", "Protein", "g"],
  ["fat", "Fat", "g"],
  ["carbohydrate", "Carbs", "g"],
  ["fiber", "Fibre", "g"],
];

const toText = (n: number | null) => (n === null ? "" : String(n));

/** A target field: empty is "no target"; whole numbers (kcal) or grams with one decimal. */
function parseTarget(key: TargetKey, text: string): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!(key === "energyKcal" ? /^\d{1,5}$/ : /^\d{1,4}(\.\d)?$/).test(t)) return undefined;
  const n = Number(t);
  if (n <= 0 || (key === "energyKcal" ? n > 20_000 : n > 2_000)) return undefined;
  return n;
}

function TargetsForm({
  current,
  history,
  today,
  historyOpen,
  onHistoryOpen,
}: {
  current: Goal | null;
  history: Goal[];
  today: string;
  historyOpen: boolean;
  onHistoryOpen: (open: boolean) => void;
}) {
  const [text, setText] = useState<Record<TargetKey, string>>(
    () => Object.fromEntries(TARGET_KEYS.map((k) => [k, toText(current?.targets[k] ?? null)])) as never,
  );
  const [note, setNote] = useState(current?.note ?? "");
  const [fix, setFix] = useState(false);
  const save = useSaveGoal();

  const parsed = Object.fromEntries(TARGET_KEYS.map((k) => [k, parseTarget(k, text[k])])) as Record<
    TargetKey,
    number | null | undefined
  >;
  const invalid = FIELDS.filter(([k]) => parsed[k] === undefined).map(([, label]) => label);
  const dirty =
    TARGET_KEYS.some((k) => parsed[k] !== (current?.targets[k] ?? null)) ||
    note.trim() !== (current?.note ?? "");
  const empty = TARGET_KEYS.every((k) => parsed[k] === null);
  const canFix = current !== null && current.id === history[0]?.id;
  const fixing = fix && canFix;

  const submit = () => {
    if (invalid.length > 0 || !dirty) return;
    const targets = parsed as Targets;
    const body = { ...targets, note: note.trim() };
    save.mutate(fixing ? { fix: current!.id, body } : { body: { ...body, effectiveFrom: today } });
  };

  return (
    <>
      <Strip
        title="Daily targets"
        meta={
          current
            ? `since ${current.effectiveFrom === today ? "today" : formatShortDate(current.effectiveFrom)}`
            : "not set"
        }
        className="bg-background"
      />
      <GuidedEntry hasGoal={current !== null} />
      <div className="divide-y divide-border border-border border-t" data-testid="targets">
        {FIELDS.map(([key, label, unit]) => (
          <label key={key} className="flex h-16 items-center gap-3 px-5">
            <span className="flex-1 font-bold uppercase tracking-[0.08em]">{label}</span>
            <input
              value={text[key]}
              onChange={(e) => setText({ ...text, [key]: e.target.value })}
              inputMode={key === "energyKcal" ? "numeric" : "decimal"}
              enterKeyHint="done"
              autoComplete="off"
              placeholder="—"
              aria-label={`${label} target in ${unit}`}
              aria-invalid={parsed[key] === undefined}
              className={cn(
                "display h-12 w-28 bg-tint px-3 text-right text-[28px] outline-none placeholder:text-muted-foreground/40 focus:bg-lime-soft",
                parsed[key] === undefined && "underline decoration-2 underline-offset-4",
              )}
            />
            <span className="w-10 font-bold text-muted-foreground text-xs uppercase">{unit}</span>
          </label>
        ))}
        <label className="flex min-h-16 items-center gap-3 px-5">
          <span className="font-bold uppercase tracking-[0.08em]">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="e.g. Cut, maintenance"
            enterKeyHint="done"
            aria-label="Note"
            className="h-12 min-w-0 flex-1 bg-tint px-3 text-right font-bold outline-none placeholder:font-medium placeholder:text-muted-foreground focus:bg-lime-soft"
          />
        </label>
        {dirty && canFix && (
          <button
            type="button"
            role="switch"
            aria-checked={fixing}
            onClick={() => setFix(!fix)}
            className="flex min-h-16 w-full items-center gap-3 bg-tint px-5 text-left outline-none focus-visible:underline"
            data-testid="fix-toggle"
          >
            <CheckSquare on={fixing} className={fixing ? undefined : "bg-background"} />
            <span>
              <span className="block font-bold">Fix a typo in the current goal</span>
              <span className="block font-medium text-muted-foreground text-sm">
                Changes the goal since {formatShortDate(current!.effectiveFrom)} in place, no new entry.
              </span>
            </span>
          </button>
        )}
      </div>

      {current?.derivation && (
        <Disclosure title="Why these targets" className="border-t" data-testid="goal-why">
          <GoalExplanation derivation={current.derivation} />
        </Disclosure>
      )}

      <Disclosure
        title="History"
        meta={history.length || undefined}
        className="border-t"
        open={historyOpen}
        onOpenChange={onHistoryOpen}
        data-testid="goal-history"
      >
        <GoalHistory goals={history} today={today} />
      </Disclosure>

      {dirty ? (
        <BottomSlab
          hint={
            invalid.length > 0
              ? `Check ${invalid.join(", ")}: whole kcal, grams like 72.5.`
              : save.isError
                ? `Couldn't save: ${save.error.message}`
                : empty
                  ? "No targets: the days show plain numbers."
                  : undefined
          }
        >
          <SlabButton
            tone="ink"
            onClick={submit}
            disabled={invalid.length > 0 || save.isPending}
            data-testid="save-goal"
          >
            {save.isPending ? "Saving…" : fixing ? "Fix current goal" : "Save · from today"}
          </SlabButton>
        </BottomSlab>
      ) : (
        <SafeBottom />
      )}
    </>
  );
}

const SHORT: Record<TargetKey, string> = {
  energyKcal: "kcal",
  protein: "Prot",
  fat: "Fat",
  carbohydrate: "Carb",
  fiber: "Fibre",
};

/** Every goal, newest first, with the days it held ("14 Oct – today"); none is ever lost. */
function GoalHistory({ goals, today }: { goals: Goal[]; today: string }) {
  if (goals.length === 0) {
    return <p className="bg-tint px-5 py-4 font-medium text-muted-foreground">No goals yet.</p>;
  }
  return (
    <ul className="divide-y divide-border bg-tint">
      {goalPeriods(goals).map((g) => {
        const future = g.effectiveFrom > today;
        const inForce = !g.replaced && !future && (g.until === null || g.until >= today);
        const period = g.replaced
          ? `${formatShortDate(g.effectiveFrom)} · replaced the same day`
          : future
            ? `from ${formatShortDate(g.effectiveFrom)}`
            : `${formatShortDate(g.effectiveFrom)} – ${g.until === null || g.until >= today ? "today" : formatShortDate(g.until)}`;
        return (
          <li key={g.id} className="px-5 py-3" data-testid="goal-row" data-in-force={inForce}>
            <div className="flex items-center justify-between gap-3">
              <Label className={g.replaced ? "text-muted-foreground" : undefined}>{period}</Label>
              {inForce && <Label className="bg-ink px-2 py-0.5 text-ink-foreground">In force</Label>}
            </div>
            <div className={cn("mt-2 grid grid-cols-5 gap-2", g.replaced && "text-muted-foreground")}>
              {TARGET_KEYS.map((k) => (
                <div key={k}>
                  <div className="display text-[20px]">
                    {g.targets[k] === null
                      ? "—"
                      : k === "energyKcal"
                        ? formatNumber(g.targets[k])
                        : formatGrams(g.targets[k])}
                  </div>
                  <Label className="mt-0.5 text-[10px] text-muted-foreground">{SHORT[k]}</Label>
                </div>
              ))}
            </div>
            {(g.note || g.derivation) && (
              <div className="mt-1 font-medium text-muted-foreground text-sm">
                {[g.derivation ? guidedLabel(g.derivation) : "", g.note].filter(Boolean).join(" · ")}
              </div>
            )}
            {g.derivation && <WhyToggle goal={g} />}
          </li>
        );
      })}
    </ul>
  );
}

/** A guided goal's explanation, opened in its history row. */
function WhyToggle({ goal }: { goal: Goal }) {
  const [open, setOpen] = useState(false);
  if (!goal.derivation) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-ml-1 mt-1 flex min-h-11 items-center px-1 font-bold text-sm uppercase tracking-[0.08em] outline-none focus-visible:underline"
      >
        {open ? "Hide why" : "Why these numbers"}
      </button>
      {open && <GoalExplanation derivation={goal.derivation} className="-mx-5 bg-background" />}
    </>
  );
}

/**
 * The way into the guided setup (#24), next to the manual targets: lime while there is no goal
 * (setting one wants the user), a full-strength tint row once there is ("Recalculate" with a
 * saved profile: it starts from the last answers).
 */
function GuidedEntry({ hasGoal }: { hasGoal: boolean }) {
  const profile = useProfile();
  const recalc = Boolean(profile.data?.profile);
  return (
    <Link
      to="/goals/guided"
      className={cn(
        "flex min-h-[72px] items-center gap-4 px-5 py-3 outline-none active:opacity-80 focus-visible:underline",
        hasGoal ? "bg-tint" : "bg-lime text-lime-foreground",
      )}
      data-testid="guided-entry"
    >
      <Compass className="size-7 shrink-0" strokeWidth={2.5} />
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-lg uppercase tracking-wide">
          {recalc ? "Recalculate" : "Guided setup"}
        </span>
        <span
          className={cn("block font-medium text-sm", hasGoal ? "text-muted-foreground" : "text-lime-muted")}
        >
          {recalc
            ? "From your profile and today's weight, explained"
            : "Cut, maintain or bulk: targets from your body and week, explained"}
        </span>
      </span>
      <ArrowRight className="size-6 shrink-0" strokeWidth={2.5} />
    </Link>
  );
}
