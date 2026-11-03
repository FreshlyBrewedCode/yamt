import { createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import {
  ageOf,
  bmiOf,
  calculateGoal,
  DAILY_LIFE,
  DAILY_LIFE_KEYS,
  type DailyLife,
  DURATIONS,
  defaultProtein,
  FAT_PERCENT,
  FAT_PRESETS,
  GOAL_KIND,
  GOAL_KINDS,
  type Goal,
  type GoalChoices,
  type GoalInputs,
  type GoalKind,
  type GoalResult,
  type GoalWeight,
  goalInForce,
  goalWeight,
  INTENSITIES,
  type Intensity,
  MAX_SESSIONS,
  PACE_LABEL,
  PACE_RATES,
  PACES,
  type Pace,
  PROTEIN,
  PROTEIN_PRESETS,
  type Profile,
  type ProteinPreset,
  REFUSALS,
  type Sex,
  TRAINING,
  TRAINING_TYPES,
  type Training,
  type WeightEntry,
} from "@yamt/shared";
import { cn } from "cn";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CheckSquare,
  Chips,
  ChoiceList,
  ChoiceRow,
  PercentSlider,
  SplitBar,
  type SplitPart,
  Stepper,
} from "@/components/choice";
import { Band, BottomSlab, iconButtonClass, Label, SlabButton, Strip } from "@/components/slab";
import { dayLabel, formatDelta, formatKg, formatNumber, localDate, startOfDay } from "@/lib/format";
import { useGoals, useProfile, useRecentWeight, useSaveGuidedGoal } from "@/lib/queries";

export const Route = createFileRoute("/goals_/guided")({ component: GuidedSetup });

const STEPS = [
  { title: "You", lead: "For your resting energy. Your weight comes from the log." },
  { title: "Daily life", lead: "A usual day, without training." },
  { title: "Training", lead: "Sessions in a usual week. Counted conservatively." },
  { title: "Goal", lead: "What should your weight do?" },
  { title: "Your targets", lead: "A starting point. Every number says why; nudge it with the presets." },
] as const;

/** Everything the flow asks; texts stay as typed until they parse. */
interface Answers {
  sex: Sex | null;
  birthYear: string;
  height: string;
  bodyFat: string;
  /** Empty: the weight from the log. Typed: logged as a new entry on save. */
  weight: string;
  pregnant: boolean;
  dailyLife: DailyLife | null;
  training: Training;
  goal: GoalKind | null;
  pace: Pace;
  /** Null: the default for the goal and training (`defaultProtein`), until the user picks one. */
  protein: ProteinPreset | null;
  fatPercent: number;
}

/** "180", "80,4": a number in [min, max] with up to `decimals` decimals, or null. */
function parseNumber(text: string, min: number, max: number, decimals = 1): number | null {
  const t = text.trim().replace(",", ".");
  const re = decimals > 0 ? new RegExp(`^\\d{1,3}(\\.\\d{1,${decimals}})?$`) : /^\d{1,4}$/;
  if (!re.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

function initialAnswers(profile: Profile | null, current: Goal | null): Answers {
  const d = current?.derivation ?? null;
  return {
    sex: profile?.sex ?? null,
    birthYear: profile ? String(profile.birthYear) : "",
    height: profile ? String(profile.heightCm) : "",
    bodyFat: profile?.bodyFatPct != null ? String(profile.bodyFatPct) : "",
    weight: "",
    pregnant: false,
    dailyLife: profile?.dailyLife ?? null,
    training: profile?.training ?? {
      sessionsPerWeek: 0,
      minutes: 60,
      type: "strength",
      intensity: "moderate",
    },
    // a recalculation starts from the choices of the guided goal in force
    goal: d?.choices.goal ?? null,
    pace: d?.choices.pace ?? "standard",
    protein: d?.choices.protein ?? null,
    fatPercent: d?.choices.fatPercent ?? FAT_PERCENT.default,
  };
}

/**
 * Guided goal setup (#24): five short steps (you, daily life, training, goal, review), one
 * question block per screen, then the targets with one explanation line per number and presets
 * to nudge them. `calculateGoal` runs live here; the server runs it again on save. Back steps
 * keep their answers; the profile pre-fills them next time.
 */
function GuidedSetup() {
  const profile = useProfile();
  const goals = useGoals();
  const weight = useRecentWeight();
  if (profile.isPending || goals.isPending || weight.isPending) {
    return (
      <Shell step={1} onBack={null} body={<p className="px-5 py-6 text-muted-foreground">Loading…</p>} />
    );
  }
  if (profile.isError || goals.isError || weight.isError) {
    return (
      <Shell
        step={1}
        onBack={null}
        body={<p className="px-5 py-6 font-medium text-muted-foreground">Can't reach yamt right now.</p>}
      />
    );
  }
  const today = localDate(Date.now());
  return (
    <Flow
      profile={profile.data.profile}
      current={goalInForce(goals.data.goals, today)}
      entries={weight.data.entries}
      today={today}
    />
  );
}

function Flow({
  profile,
  current,
  entries,
  today,
}: {
  profile: Profile | null;
  current: Goal | null;
  entries: WeightEntry[];
  today: string;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const save = useSaveGuidedGoal();
  const [step, setStep] = useState(1);
  const [a, setA] = useState<Answers>(() => initialAnswers(profile, current));
  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }));
  const now = Date.now();

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step starts at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const leave = () =>
    canGoBack ? router.history.back() : void router.navigate({ to: "/goals", replace: true });
  const back = () => (step > 1 ? setStep(step - 1) : leave());

  // step 1's numbers
  const thisYear = Number(today.slice(0, 4));
  const birthYear = parseNumber(a.birthYear, 1900, thisYear, 0);
  const height = parseNumber(a.height, 100, 250);
  const bodyFat = a.bodyFat.trim() === "" ? null : parseNumber(a.bodyFat, 3, 70);
  const bodyFatInvalid = a.bodyFat.trim() !== "" && bodyFat === null;
  const typedKg = a.weight.trim() === "" ? null : parseNumber(a.weight, 20, 500, 2);
  const weightInvalid = a.weight.trim() !== "" && typedKg === null;
  const logWeight = goalWeight(entries, now);
  const weight =
    typedKg !== null ? goalWeight([...entries, { kg: typedKg, measuredAt: now }], now) : logWeight;

  const refusal =
    birthYear !== null && ageOf(birthYear, today) < 18
      ? REFUSALS.under_18
      : a.sex === "female" && a.pregnant
        ? REFUSALS.pregnancy
        : null;
  const youDone =
    a.sex !== null &&
    birthYear !== null &&
    height !== null &&
    !bodyFatInvalid &&
    !weightInvalid &&
    weight !== null &&
    refusal === null;

  const inputs: GoalInputs | null =
    youDone && a.dailyLife
      ? {
          sex: a.sex!,
          birthYear: birthYear!,
          heightCm: height!,
          weightKg: weight!.kg,
          bodyFatPct: bodyFat,
          dailyLife: a.dailyLife,
          training: a.training,
          today,
          pregnantOrBreastfeeding: false,
        }
      : null;
  const underweight = weight !== null && height !== null && bmiOf(weight.kg, height) < 18.5;
  const choices: GoalChoices | null =
    inputs && a.goal
      ? {
          goal: a.goal,
          pace: a.pace,
          protein: a.protein ?? defaultProtein(inputs, a.goal),
          fatPercent: a.fatPercent,
        }
      : null;
  const calc = inputs && choices ? calculateGoal(inputs, choices) : null;
  const result = calc?.ok ? calc : null;

  const canNext =
    step === 1
      ? youDone
      : step === 2
        ? a.dailyLife !== null
        : step === 3
          ? true
          : step === 4
            ? result !== null
            : result !== null && !save.isPending;

  const submit = () => {
    if (!inputs || !choices || !a.sex || birthYear === null || height === null) return;
    save.mutate(
      {
        profile: {
          sex: a.sex,
          birthYear,
          heightCm: height,
          bodyFatPct: bodyFat,
          dailyLife: inputs.dailyLife,
          training: a.training,
        },
        choices,
        pregnantOrBreastfeeding: false,
        ...(typedKg !== null ? { weightKg: typedKg } : {}),
        effectiveFrom: today,
      },
      { onSuccess: leave },
    );
  };

  const hint =
    step === 1 && !youDone && refusal === null
      ? bodyFatInvalid
        ? "Body fat in %, like 18, or leave it empty."
        : weightInvalid
          ? "Weight in kg, like 81.4."
          : "Fill in sex, birth year, height and weight."
      : step === 2 && !canNext
        ? "Pick the one closest to a usual day."
        : step === 4 && !canNext
          ? "Pick a goal."
          : step === 5 && save.isError
            ? `Couldn't save: ${save.error.message}`
            : undefined;

  const body =
    step === 1 ? (
      <YouStep
        a={a}
        set={set}
        logWeight={logWeight}
        weight={weight}
        typed={typedKg !== null}
        refusal={refusal}
        bodyFatInvalid={bodyFatInvalid}
        weightInvalid={weightInvalid}
        now={now}
      />
    ) : step === 2 ? (
      <DailyLifeStep a={a} set={set} />
    ) : step === 3 ? (
      <TrainingStep a={a} set={set} />
    ) : step === 4 ? (
      <GoalStep a={a} set={set} inputs={inputs} choices={choices} underweight={underweight} />
    ) : result && choices ? (
      <Review result={result} choices={choices} set={set} weight={weight!} />
    ) : null;

  return (
    <Shell
      step={step}
      onBack={back}
      body={body}
      footer={
        // a refusal says why in its band; no action to wait for
        step === 1 && refusal ? null : (
          <BottomSlab hint={hint}>
            <SlabButton
              onClick={() => (step < 5 ? setStep(step + 1) : submit())}
              disabled={!canNext}
              data-testid="guided-next"
            >
              {step < 5 ? "Next" : save.isPending ? "Saving…" : "Save · from today"}
            </SlabButton>
          </BottomSlab>
        )
      }
    />
  );
}

/** The header (back, the step count, title, lead, progress) above a step's body. */
function Shell({
  step,
  onBack,
  body,
  footer,
}: {
  step: number;
  onBack: (() => void) | null;
  body: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const s = STEPS[step - 1]!;
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack ?? undefined}
            disabled={!onBack}
            className={cn(iconButtonClass, "-ml-1")}
            aria-label={step > 1 ? "Previous step" : "Back"}
          >
            <ArrowLeft className="size-6" strokeWidth={2.5} />
          </button>
          <Label className="text-muted-foreground" data-testid="guided-step">
            Guided setup · {step} / {STEPS.length}
          </Label>
        </div>
        <h1 className="display mt-4 text-[36px]">{s.title}</h1>
        <p className="mt-2 font-medium text-muted-foreground">{s.lead}</p>
        <div className="mt-4 grid grid-cols-5 gap-1" aria-hidden>
          {STEPS.map((x, i) => (
            <div key={x.title} className={cn("h-1.5", i < step ? "bg-foreground" : "bg-tint")} />
          ))}
        </div>
      </header>
      <main className="flex-1">{body}</main>
      {footer}
    </>
  );
}

type StepProps = { a: Answers; set: (patch: Partial<Answers>) => void };

const fieldClass =
  "display h-12 w-28 bg-tint px-3 text-right text-[28px] outline-none placeholder:text-muted-foreground/40 focus:bg-lime-soft";

/** A 64 px row: the name as an uppercase label (and a note under it), a tint field, the unit. */
function FieldRow({
  label,
  note,
  unit,
  invalid = false,
  ...input
}: {
  label: string;
  note?: string;
  unit: string;
  invalid?: boolean;
} & React.ComponentProps<"input">) {
  return (
    <label className="flex min-h-16 items-center gap-3 px-5">
      <span className="flex-1">
        <span className="block font-bold uppercase tracking-[0.08em]">{label}</span>
        {note && <span className="block font-medium text-muted-foreground text-sm">{note}</span>}
      </span>
      <input
        autoComplete="off"
        enterKeyHint="done"
        aria-label={`${label} in ${unit}`}
        aria-invalid={invalid}
        className={cn(fieldClass, invalid && "underline decoration-2 underline-offset-4")}
        {...input}
      />
      <span className="w-10 font-bold text-muted-foreground text-xs uppercase">{unit}</span>
    </label>
  );
}

function YouStep({
  a,
  set,
  logWeight,
  weight,
  typed,
  refusal,
  bodyFatInvalid,
  weightInvalid,
  now,
}: StepProps & {
  logWeight: GoalWeight | null;
  weight: GoalWeight | null;
  typed: boolean;
  refusal: string | null;
  bodyFatInvalid: boolean;
  weightInvalid: boolean;
  now: number;
}) {
  const source = logWeight
    ? `From your log: ${formatKg(logWeight.kg)} kg, ${
        logWeight.basis === "average"
          ? `the 7-day average of ${logWeight.count} entries`
          : `the latest entry (${dayLabel(startOfDay(logWeight.measuredAt), now).toLowerCase()})`
      }.`
    : "No weight logged yet.";
  return (
    <>
      <div className="divide-y divide-border border-border border-y">
        <div className="flex min-h-16 items-center gap-3 px-5">
          <span className="flex-1 font-bold uppercase tracking-[0.08em]">Sex</span>
          <Chips
            label="Sex"
            className="w-[calc(14rem+2px)]"
            options={[
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
            ]}
            value={a.sex}
            onChange={(sex) => set({ sex })}
          />
        </div>
        <FieldRow
          label="Born"
          unit="year"
          value={a.birthYear}
          onChange={(e) => set({ birthYear: e.target.value })}
          inputMode="numeric"
          placeholder="—"
          maxLength={4}
        />
        <FieldRow
          label="Height"
          unit="cm"
          value={a.height}
          onChange={(e) => set({ height: e.target.value })}
          inputMode="decimal"
          placeholder="—"
        />
        <FieldRow
          label="Body fat"
          note="optional"
          unit="%"
          value={a.bodyFat}
          onChange={(e) => set({ bodyFat: e.target.value })}
          inputMode="decimal"
          placeholder="—"
          invalid={bodyFatInvalid}
        />
        <FieldRow
          label="Weight"
          note={logWeight ? (typed ? "new entry" : "from the log") : "logged on save"}
          unit="kg"
          value={a.weight}
          onChange={(e) => set({ weight: e.target.value })}
          inputMode="decimal"
          placeholder={logWeight ? formatKg(logWeight.kg) : "—"}
          invalid={weightInvalid}
        />
        <p className="px-5 py-3 font-medium text-muted-foreground text-sm" data-testid="weight-source">
          {source}{" "}
          {typed && weight
            ? `Using ${formatKg(weight.kg)} kg; ${typedKgNote(weight)}`
            : logWeight
              ? "Type today's weight to log it when you save."
              : "Type it in: it's logged when you save."}
        </p>
        {a.sex === "female" && (
          <button
            type="button"
            role="switch"
            aria-checked={a.pregnant}
            onClick={() => set({ pregnant: !a.pregnant })}
            className="flex min-h-16 w-full items-center gap-3 px-5 text-left outline-none focus-visible:underline"
            data-testid="pregnant-toggle"
          >
            <span className="flex-1 font-bold">Pregnant or breastfeeding</span>
            <CheckSquare on={a.pregnant} />
          </button>
        )}
      </div>
      {refusal ? (
        <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="refusal">
          <Label className="text-muted-foreground">Not calculated</Label>
          <p className="mt-2 font-medium">{refusal}</p>
        </Band>
      ) : (
        <Band className="px-5 pt-4 pb-5">
          <Label className="text-muted-foreground">Why these</Label>
          <p className="mt-2 font-medium text-muted-foreground text-sm">
            Sex, age, height and weight give your resting energy (Mifflin-St Jeor). With body fat under 25 %
            (men) or 32 % (women), yamt uses your lean mass instead (Cunningham), which fits lean, active
            people better. A smart scale's figure is good enough.
          </p>
        </Band>
      )}
    </>
  );
}

const typedKgNote = (w: GoalWeight) =>
  w.basis === "average" ? `the 7-day average with the new entry (${w.count}).` : "the new entry.";

function DailyLifeStep({ a, set }: StepProps) {
  return (
    <ChoiceList label="Daily life" className="divide-y divide-border border-border border-y">
      {DAILY_LIFE_KEYS.map((k) => (
        <ChoiceRow
          key={k}
          title={DAILY_LIFE[k].label}
          detail={DAILY_LIFE[k].example}
          selected={a.dailyLife === k}
          onSelect={() => set({ dailyLife: k })}
          data-testid={`daily-${k}`}
        />
      ))}
    </ChoiceList>
  );
}

const INTENSITY: Record<Intensity, { label: string; detail: string }> = {
  moderate: {
    label: "Moderate",
    detail: "You could still talk in full sentences; sets end with reps to spare.",
  },
  hard: { label: "Hard", detail: "Out of breath, or sets close to failure with short rests." },
};

function TrainingStep({ a, set }: StepProps) {
  const t = a.training;
  const setT = (patch: Partial<Training>) => set({ training: { ...t, ...patch } });
  return (
    <>
      <Band className="px-5 pt-2 pb-5">
        <Stepper
          value={t.sessionsPerWeek}
          min={0}
          max={MAX_SESSIONS}
          onChange={(n) => setT({ sessionsPerWeek: n })}
          label="Sessions per week"
          unit={
            t.sessionsPerWeek === 0
              ? "No training"
              : t.sessionsPerWeek === 1
                ? "session a week"
                : "sessions a week"
          }
        />
        {t.sessionsPerWeek === 0 && (
          <p className="mt-4 text-center font-medium text-muted-foreground text-sm">
            Nothing more to ask: walking and daily life are already counted.
          </p>
        )}
      </Band>
      {t.sessionsPerWeek > 0 && (
        <>
          <Strip title="Type" />
          <ChoiceList label="Type of training">
            {TRAINING_TYPES.map((k) => (
              <ChoiceRow
                key={k}
                title={TRAINING[k].label}
                detail={TRAINING[k].example}
                selected={t.type === k}
                onSelect={() => setT({ type: k })}
                data-testid={`type-${k}`}
              />
            ))}
          </ChoiceList>
          <Strip title="A session" meta="typical length" />
          <Band className="px-5 pt-3 pb-4">
            <Chips
              label="Typical duration"
              options={DURATIONS.map((d) => ({ value: d, label: "min", sub: d }))}
              value={t.minutes}
              onChange={(minutes) => setT({ minutes })}
            />
          </Band>
          <Strip title="Intensity" />
          <Band className="px-5 pt-3 pb-5">
            <Chips
              label="Intensity"
              options={INTENSITIES.map((i) => ({ value: i, label: INTENSITY[i].label }))}
              value={t.intensity}
              onChange={(intensity) => setT({ intensity })}
            />
            <p className="mt-3 font-medium text-muted-foreground text-sm">{INTENSITY[t.intensity].detail}</p>
          </Band>
        </>
      )}
    </>
  );
}

/** "≈ 0.4 kg a week". */
function kgPerWeek(r: GoalResult): string {
  const kg = Math.abs(r.pace.kgPerWeek);
  return `≈ ${kg.toFixed(kg < 0.1 ? 2 : 1)} kg a week`;
}

/** "≈ 0.4 kg a week, −440 kcal a day": what a pace means. */
const paceWords = (r: GoalResult): string =>
  `${kgPerWeek(r)}, ${formatDelta(r.pace.delta)} kcal a day${r.pace.cap || r.kcal.floorApplied ? " (limited)" : ""}`;

function GoalStep({
  a,
  set,
  inputs,
  choices,
  underweight,
}: StepProps & {
  inputs: GoalInputs | null;
  choices: GoalChoices | null;
  underweight: boolean;
}) {
  const at = (goal: GoalKind, pace: Pace) => {
    if (!inputs || !choices) return null;
    const r = calculateGoal(inputs, {
      ...choices,
      goal,
      pace,
      protein: a.protein ?? defaultProtein(inputs, goal),
    });
    return r.ok ? r : null;
  };
  const maintenance = at("maintain", "standard");
  return (
    <>
      <ChoiceList label="Goal" className="divide-y divide-border border-border border-y">
        {GOAL_KINDS.map((g) => {
          const off = g === "cut" && underweight;
          return (
            <ChoiceRow
              key={g}
              title={GOAL_KIND[g].label}
              detail={off ? REFUSALS.underweight_cut : GOAL_KIND[g].example}
              selected={a.goal === g}
              disabled={off}
              onSelect={() => set({ goal: g })}
              data-testid={`goal-${g}`}
            />
          );
        })}
      </ChoiceList>
      {a.goal === "maintain" && maintenance && (
        <p className="px-5 py-4 font-medium text-muted-foreground">
          Eat at maintenance: ≈ {formatNumber(maintenance.kcal.value)} kcal a day.
        </p>
      )}
      {(a.goal === "cut" || a.goal === "bulk") && (
        <>
          <Strip title="Pace" meta="of your weight, per week" />
          <ChoiceList label="Pace">
            {PACES.map((p) => {
              const r = at(a.goal!, p);
              return (
                <ChoiceRow
                  key={p}
                  title={`${PACE_LABEL[p]} · ${PACE_RATES[a.goal as "cut" | "bulk"][p]} %`}
                  detail={r ? paceWords(r) : undefined}
                  selected={a.pace === p}
                  onSelect={() => set({ pace: p })}
                  data-testid={`pace-${p}`}
                />
              );
            })}
          </ChoiceList>
          <p className="px-5 py-4 font-medium text-muted-foreground text-sm">
            {a.goal === "cut"
              ? "Slower cuts keep more muscle and are easier to hold. Standard suits most."
              : "A small surplus builds about as much muscle as a big one, with less fat. Gentle suits trained lifters."}
          </p>
        </>
      )}
    </>
  );
}

const PCT = (share: number) => `${Math.round(share * 100)} %`;

function Review({
  result: r,
  choices,
  set,
  weight,
}: {
  result: GoalResult;
  choices: GoalChoices;
  set: (patch: Partial<Answers>) => void;
  weight: GoalWeight;
}) {
  const parts: (SplitPart & { grams: number; testid: string })[] = [
    {
      key: "protein",
      label: "Prot",
      share: r.split.protein,
      fill: "bg-lime",
      grams: r.protein.grams,
      testid: "protein",
    },
    {
      key: "fat",
      label: "Fat",
      share: r.split.fat,
      fill: "bg-ink-foreground",
      grams: r.fat.grams,
      testid: "fat",
    },
    {
      key: "carbs",
      label: "Carb",
      share: r.split.carbs,
      fill: "bg-ink-muted",
      grams: r.carbs.grams,
      testid: "carbs",
    },
    {
      key: "fiber",
      label: "Fibre",
      share: r.split.fiber,
      fill: "bg-ink-line",
      grams: r.fiber.grams,
      testid: "fiber",
    },
  ];
  const goal = choices.goal;
  return (
    <>
      {/* the one thing on this screen: the kcal, how they come about, and the split */}
      <Band tone="ink" className="px-5 pt-4 pb-5" data-testid="review-slab">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="display text-[64px]" data-testid="review-kcal">
              {formatNumber(r.kcal.value)}
            </div>
            <Label className="mt-2 text-ink-muted">kcal a day · {GOAL_KIND[goal].label}</Label>
          </div>
          <div className="pb-1 text-right">
            <div className="display text-[28px]" data-testid="review-maintenance">
              {formatNumber(r.maintenance.kcal)}
            </div>
            <Label className="mt-1 text-ink-muted">maintenance</Label>
          </div>
        </div>
        <Label className="mt-3 text-ink-muted normal-case tracking-normal" data-testid="review-delta">
          {goal === "maintain" && r.pace.delta === 0
            ? "At maintenance: your weight should hold."
            : `${formatDelta(r.pace.delta)} kcal a day · ${kgPerWeek(r)}`}
        </Label>
        <SplitBar parts={parts} className="mt-4" />
        <div className="mt-3 grid grid-cols-4 gap-3">
          {parts.map((p) => (
            <div key={p.key} data-testid={`review-${p.testid}`}>
              <div className="flex items-baseline gap-0.5">
                <span className="display text-[24px]">{formatNumber(p.grams)}</span>
                <span className="font-bold text-ink-muted text-xs">g</span>
              </div>
              <Label className="mt-1.5 flex items-center gap-1.5 text-ink-muted">
                <span className={cn("size-2.5 shrink-0", p.fill)} aria-hidden />
                {p.label}
              </Label>
              <div className="mt-0.5 font-bold text-[11px] tracking-[0.06em]">{PCT(p.share)}</div>
            </div>
          ))}
        </div>
      </Band>

      <Strip title="Energy" meta={`${formatNumber(r.kcal.value)} kcal`} />
      <Lines lines={[r.lines.rmr, r.lines.dailyLife, r.lines.exercise, r.lines.maintenance, r.lines.delta]} />
      {goal !== "maintain" && (
        <Band className="px-5 pb-5">
          <Label className="mb-2 text-muted-foreground">Pace</Label>
          <Chips
            label="Pace"
            options={PACES.map((p) => ({
              value: p,
              label: PACE_LABEL[p],
              sub: `${PACE_RATES[goal][p]} %`,
            }))}
            value={choices.pace}
            onChange={(pace) => set({ pace })}
            data-testid="pace-chips"
          />
        </Band>
      )}

      <Strip title="Protein" meta={`${r.protein.grams} g · ${PCT(r.split.protein)}`} />
      <Lines lines={[r.lines.protein]} />
      <Band className="px-5 pb-5">
        <Chips
          label="Protein"
          options={PROTEIN_PRESETS.map((p) => ({
            value: p,
            label: PROTEIN[p].label,
            sub: PROTEIN[p].gPerKg.toFixed(1),
          }))}
          value={choices.protein}
          onChange={(protein) => set({ protein })}
          data-testid="protein-chips"
        />
        <Label className="mt-2 text-right text-muted-foreground">
          g per kg{r.referenceWeightKg !== weight.kg ? ` of ${formatKg(r.referenceWeightKg)}` : ""}
        </Label>
      </Band>

      <Strip title="Fat" meta={`${r.fat.grams} g · ${PCT(r.split.fat)}`} />
      <Lines lines={[r.lines.fat]} />
      <Band className="px-5 pb-4">
        <Chips
          label="Fat"
          options={FAT_PRESETS.map((f) => ({ value: f.percent, label: f.label, sub: `${f.percent} %` }))}
          value={choices.fatPercent}
          onChange={(fatPercent) => set({ fatPercent })}
          data-testid="fat-chips"
        />
        <div className="mt-3">
          <PercentSlider
            label="Fat, % of energy"
            min={FAT_PERCENT.min}
            max={FAT_PERCENT.max}
            step={FAT_PERCENT.step}
            value={choices.fatPercent}
            onChange={(fatPercent) => set({ fatPercent })}
          />
        </div>
      </Band>

      <Strip title="Carbs" meta={`${r.carbs.grams} g · ${PCT(r.split.carbs)}`} />
      <Lines lines={[r.lines.carbs]} />
      <Strip title="Fibre" meta={`${r.fiber.grams} g`} />
      <Lines lines={[r.lines.fiber]} />

      <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="review-notes">
        {r.notes.length > 0 && (
          <ul className="mb-3 space-y-2 font-medium">
            {r.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span aria-hidden>■</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="font-medium text-muted-foreground text-sm">
          {r.footer} Weight {formatKg(weight.kg)} kg
          {weight.basis === "average" ? ` (7-day average of ${weight.count})` : ""}.
        </p>
      </Band>
    </>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1.5 px-5 pt-3 pb-4">
      {lines.map((l) => (
        <li key={l} className="font-medium text-[15px] leading-snug">
          {l}
        </li>
      ))}
    </ul>
  );
}
