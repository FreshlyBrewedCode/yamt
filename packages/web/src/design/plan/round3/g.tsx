// Direction G (round 3, the consolidation): F · Starters with D's docked composer. The overview's
// Log | Plan slab and Planning strip; the plan entry screen (tonight's nightly suggestions, the
// starters, the filter summary, the dock); the filter page; the request thread with the outline;
// the recipe detail; the plan view; the shopping list; Settings → Planning; the Ate-it sheet.
import { ArrowLeft, CalendarDays, Scale, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import { iconButtonClass, Label, Strip } from "@/components/slab";
import { PLANNED, type Recipe } from "../mock";
import {
  ATTACHED,
  AttachSheet,
  Composer,
  KeyboardFrame,
  pickedMeals,
  STARTERS,
  useComposer,
  type Verdicts,
} from "../round2/parts";
import { AteSheet, OverviewMock, PlanSheet } from "../shared";
import type { Screen3 } from "../variants";
import { ALL_RECIPES, PLANNED_G } from "./mock3";
import {
  DEFAULT3,
  Dock,
  FilterPage,
  FilterSummary,
  type Filters3,
  NightlySection,
  type NightlyState,
  PlanningRowsG,
  PlanViewG,
  REQUEST3,
  RecipeScreenG,
  SettingsPlanningScreen,
  ShoppingScreen,
  SplitSlabG,
  StarterBand,
  ThreadG,
  type ThreadStage3,
} from "./parts3";

const TONES: ("ink" | "tint" | "plain")[] = ["ink", "tint", "plain", "tint", "plain", "tint"];

/** Round 1 as the user left it before round 2: the curry for Tue, the oven dish rejected. */
const AFTER_ROUND_1: Verdicts = {
  curry: { kind: "picked", date: "2026-11-04", slot: "dinner" },
  ofen: { kind: "rejected" },
};
const AFTER_ROUND_2: Verdicts = {
  ...AFTER_ROUND_1,
  shakshuka: { kind: "picked", date: "2026-11-05", slot: "dinner" },
};

const THREAD: Partial<Record<Screen3, ThreadStage3>> = {
  "thread-progress": "progress",
  "thread-done": "done",
  "thread-partial": "partial",
  "thread-round2": "round2",
};

export function PlanG({ screen, go }: { screen: Screen3; go: (s: Screen3) => void }) {
  return <Inner key={screen} screen={screen} go={go} />;
}

function Inner({ screen, go }: { screen: Screen3; go: (s: Screen3) => void }) {
  const [ate, setAte] = useState(screen === "ate");
  const [open, setOpen] = useState<Recipe | null>(null);
  const [planFor, setPlanFor] = useState<Recipe | null>(null);
  const [verdicts, setVerdicts] = useState<Verdicts>(() =>
    screen === "thread-round2"
      ? AFTER_ROUND_2
      : screen === "thread-partial"
        ? { curry: AFTER_ROUND_1.curry }
        : {},
  );
  const [nightlyVerdicts, setNightlyVerdicts] = useState<Verdicts>({});
  const [filters, setFilters] = useState<Filters3>(
    screen === "filters"
      ? REQUEST3
      : screen === "entry-attached"
        ? { ...DEFAULT3, time: "40", useUp: ["½ Hokkaido"] }
        : DEFAULT3,
  );
  const [nightly, setNightly] = useState<NightlyState>(
    screen === "entry-bare" ? "off" : screen === "entry-regenerating" ? "regenerating" : "ready",
  );
  const tonight = PLANNED_G[0]!;
  const c = useComposer(
    screen === "entry-typing"
      ? { text: STARTERS[1]!.text }
      : screen === "entry-attached"
        ? { text: STARTERS[1]!.text, attachments: ATTACHED.slice(0, 2) }
        : {},
  );
  const keyboard = screen === "entry-typing";
  const stage = THREAD[screen];

  const planSheet = (
    <PlanSheet
      recipe={planFor}
      open={planFor !== null}
      planned={stage ? pickedMeals(verdicts) : PLANNED}
      defaultDate={
        (planFor &&
          verdicts[planFor.id]?.kind === "picked" &&
          (verdicts[planFor.id] as { date: string }).date) ||
        "2026-11-05"
      }
      cook
      onClose={() => setPlanFor(null)}
      onPlan={(date, slot) => {
        if (planFor) setVerdicts({ ...verdicts, [planFor.id]: { kind: "picked", date, slot } });
        setPlanFor(null);
        setOpen(null);
      }}
    />
  );

  if (screen === "recipe" || screen === "ate") {
    const r = ALL_RECIPES.get(tonight.recipeId)!;
    return (
      <>
        <RecipeScreenG
          recipe={r}
          planned={tonight}
          onBack={() => go("overview")}
          onAte={() => setAte(true)}
          onPlan={() => {}}
        />
        <AteSheet
          recipe={r}
          factor={tonight.factor}
          cooked={tonight.cooked}
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

  if (open) {
    const planned = PLANNED_G.find((p) => p.recipeId === open.id) ?? null;
    return (
      <>
        <RecipeScreenG
          recipe={open}
          planned={screen === "plan" ? planned : null}
          onBack={() => setOpen(null)}
          onAte={() => setAte(true)}
          onPlan={() => setPlanFor(open)}
        />
        {planSheet}
      </>
    );
  }

  if (screen === "overview") {
    return (
      <>
        <OverviewMock
          planned={PLANNED_G}
          onOpenPlanned={() => go("recipe")}
          onAte={() => setAte(true)}
          headerRight={
            <>
              <span className={iconButtonClass} aria-hidden>
                <CalendarDays className="size-6" strokeWidth={2.5} />
              </span>
              <span className={iconButtonClass} aria-hidden>
                <Scale className="size-6" strokeWidth={2.5} />
              </span>
              <button
                type="button"
                onClick={() => go("settings")}
                className={iconButtonClass}
                aria-label="Settings"
              >
                <Settings className="size-6" strokeWidth={2.5} />
              </button>
            </>
          }
          beforeToday={<PlanningRowsG onOpen={() => go("thread-done")} onTonight={() => go("entry")} />}
          slab={<SplitSlabG onLog={() => {}} onPlan={() => go("entry")} />}
        />
        <AteSheet
          recipe={ALL_RECIPES.get(tonight.recipeId)!}
          factor={tonight.factor}
          cooked={tonight.cooked}
          open={ate}
          onClose={() => setAte(false)}
          onLogged={() => setAte(false)}
        />
      </>
    );
  }

  if (screen === "filters") {
    return <FilterPage filters={filters} onChange={setFilters} onDone={() => go("entry")} />;
  }

  if (screen === "plan") {
    return (
      <PlanViewG
        onBack={() => go("overview")}
        onOpen={setOpen}
        onShopping={() => go("shopping")}
        onPlanDay={() => go("entry")}
      />
    );
  }

  if (screen === "shopping") return <ShoppingScreen onBack={() => go("plan")} />;

  if (screen === "settings") return <SettingsPlanningScreen onBack={() => go("overview")} />;

  if (stage) {
    return (
      <>
        <ThreadG
          stage={stage}
          verdicts={verdicts}
          setVerdicts={setVerdicts}
          onBack={() => go("overview")}
          onPlanView={() => go("plan")}
          onOpen={setOpen}
          onChange={setPlanFor}
          onSuggestMore={() => go("thread-progress")}
        />
        <Dock>
          <Composer
            text={c.text}
            placeholder={stage === "progress" ? "Add more for the next round…" : "Say what to change…"}
            attachments={c.attachments}
            send
            recording={c.recording}
            onMic={c.mic}
            onAttach={() => c.setAttach(true)}
            onSend={() => go("thread-round2")}
          />
          {stage !== "progress" && !c.has && (
            <Label className="mt-2 flex items-center justify-center gap-1.5 text-center text-muted-foreground normal-case tracking-normal">
              <Sparkles className="size-3.5" strokeWidth={2.5} /> Pick above, steer here, or ask for more: a
              round takes minutes.
            </Label>
          )}
        </Dock>
        <AttachSheet open={c.attach} onClose={() => c.setAttach(false)} />
        {planSheet}
      </>
    );
  }

  // the plan entry screen
  const body = (
    <>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <button
          type="button"
          onClick={() => go("overview")}
          aria-label="Back"
          className={`${iconButtonClass} -ml-1`}
        >
          <ArrowLeft className="size-6" strokeWidth={2.5} />
        </button>
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Plan · Tue 4 Nov</Label>
          <h1 className="display mt-1 text-[36px]">What to cook?</h1>
        </div>
        <button type="button" onClick={() => go("plan")} className={iconButtonClass} aria-label="Plan view">
          <CalendarDays className="size-6" strokeWidth={2.5} />
        </button>
      </header>
      <main className="flex-1">
        <NightlySection
          state={nightly}
          verdicts={nightlyVerdicts}
          setVerdicts={setNightlyVerdicts}
          onOpen={setOpen}
          onRegenerate={() => setNightly("regenerating")}
        />
        <Strip title="Start from" meta="from your days" />
        <ul className="divide-y divide-border">
          {STARTERS.map((s, i) => (
            <StarterBand key={s.id} s={s} tone={TONES[i] ?? "plain"} onPick={c.pickStarter} />
          ))}
        </ul>
        {nightly === "off" && (
          <button
            type="button"
            onClick={() => go("settings")}
            className="flex min-h-14 w-full items-center gap-3 border-border border-t px-5 text-left text-muted-foreground active:bg-tint"
          >
            <span className="flex-1 font-medium text-sm">Nightly suggestions for today are off.</span>
            <Label>Settings →</Label>
          </button>
        )}
      </main>
      <Dock above={<FilterSummary filters={filters} onOpen={() => go("filters")} />}>
        <Composer
          text={c.text}
          placeholder="Or say what you fancy…"
          focused={keyboard}
          attachments={c.attachments}
          send
          recording={c.recording}
          onMic={c.mic}
          onAttach={() => c.setAttach(true)}
          onSend={() => go("thread-progress")}
        />
      </Dock>
      <AttachSheet open={c.attach} onClose={() => c.setAttach(false)} />
      {planSheet}
    </>
  );
  return keyboard ? <KeyboardFrame scroll="bottom">{body}</KeyboardFrame> : body;
}
