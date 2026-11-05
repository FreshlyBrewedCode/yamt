// Variant D · Dock: chat-like. The composer is the sticky bottom slab on every planning screen
// (plus, field, mic, a lime send square once there is something to send); chosen filters ride in
// it as chips. Above it: what's open tonight (ink), the starters as rows, the filters as a tint
// band right over the dock. In a thread the dock is the steer, with quick steer chips.
import { Sparkles } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Band, Label, Strip } from "@/components/slab";
import { fmt, LEFT_TODAY } from "../mock";
import { Header } from "../shared";
import type { Screen2 } from "../variants";
import { type Ctx, Frame } from "./frame";
import {
  ATTACHED,
  AttachSheet,
  Composer,
  chipWords,
  FilterChips,
  FilterGroups,
  KeyboardFrame,
  REQUEST_FILTERS,
  STARTERS,
  STEER_TYPED,
  STEERS,
  StarterRow,
  Thread,
  ToggleChip,
  TYPED,
  useComposer,
} from "./parts";

export function PlanD({ screen, go }: { screen: Screen2; go: (s: Screen2) => void }) {
  return <Frame screen={screen} go={go} compose={(ctx) => <ComposeD ctx={ctx} />} />;
}

/** What's open tonight, and what there is to use up: the composer screen's ink slab. */
function OpenTonight() {
  return (
    <Band tone="ink" className="px-5 pt-4 pb-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="display text-[64px]">{fmt(LEFT_TODAY.energyKcal)}</div>
          <Label className="mt-2 text-ink-muted">kcal open tonight</Label>
        </div>
        <div className="pb-1 text-right">
          <div className="display text-[28px] text-lime">
            {fmt(LEFT_TODAY.protein)}
            <span className="ml-0.5 text-[16px] text-ink-muted">g</span>
          </div>
          <Label className="mt-1 text-ink-muted">protein open</Label>
        </div>
      </div>
      <Label className="mt-4 border-ink-line border-t pt-3 text-ink-muted">
        ½ Hokkaido · 200 g Feta to use up · Wed–Fri nothing planned
      </Label>
    </Band>
  );
}

/** The dock: the composer as the sticky footer, on the page colour, clear of the home indicator. */
function Dock({ children }: { children: React.ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 bg-background pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
      {children}
    </footer>
  );
}

function ComposeD({ ctx }: { ctx: Ctx }) {
  const { screen, go } = ctx;
  const inThread =
    screen === "suggesting" || screen === "suggestions" || screen === "steer" || screen === "round2";
  const c = useComposer(
    screen === "typing"
      ? { text: TYPED }
      : screen === "attached"
        ? { text: TYPED, attachments: ATTACHED, filters: REQUEST_FILTERS }
        : screen === "steer"
          ? { text: STEER_TYPED }
          : {},
  );
  const [steers, setSteers] = useState<string[]>(screen === "steer" ? ["Faster"] : []);
  const keyboard = screen === "typing" || screen === "steer";
  const sheet = <AttachSheet open={c.attach} onClose={() => c.setAttach(false)} />;

  if (!inThread) {
    const words = chipWords(c.filters);
    const body = (
      <>
        <Header label="Plan" title="What do you fancy?" onBack={() => go("overview")} />
        <main className="flex-1">
          <OpenTonight />
          <Strip title="Start from" meta="from your days" />
          <ul className="divide-y divide-border">
            {STARTERS.map((s) => (
              <StarterRow key={s.id} s={s} onPick={c.pickStarter} />
            ))}
          </ul>
          <Band tone="tint" className="pt-4 pb-5">
            <FilterGroups filters={c.filters} onChange={c.setFilters} surface="tint" />
          </Band>
        </main>
        <Dock>
          <Composer
            text={c.text}
            focused={keyboard}
            attachments={c.attachments}
            chips={
              <FilterChips
                words={words}
                onClear={() =>
                  c.setFilters({
                    ...c.filters,
                    when: "tonight",
                    days: [],
                    time: "any",
                    constraints: [],
                    useUp: [],
                  })
                }
              />
            }
            send
            recording={c.recording}
            onMic={c.mic}
            onAttach={() => c.setAttach(true)}
            onSend={() => go("suggesting")}
          />
        </Dock>
        {sheet}
      </>
    );
    return keyboard ? <KeyboardFrame scroll="bottom">{body}</KeyboardFrame> : body;
  }

  const stage = screen === "suggesting" ? "suggesting" : screen === "round2" ? "round2" : "round1";
  const body = (
    <>
      <Thread
        stage={stage}
        verdicts={ctx.verdicts}
        setVerdicts={ctx.setVerdicts}
        onBack={() => go("overview")}
        onPlanView={() => go("plan")}
        onOpen={ctx.openRecipe}
        onChange={ctx.change}
        tail={
          stage === "suggesting" ? (
            <p className="px-5 py-4 font-medium text-muted-foreground text-sm leading-snug">
              Anything you add below goes into the next round.
            </p>
          ) : undefined
        }
      />
      <Dock>
        <Composer
          text={c.text}
          placeholder={stage === "suggesting" ? "Add more for the next round…" : "Say what to change…"}
          focused={keyboard}
          attachments={c.attachments}
          chips={
            stage !== "suggesting" && (
              <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
                {STEERS.map((s) => (
                  <ToggleChip
                    key={s}
                    on={steers.includes(s)}
                    className="h-10"
                    onClick={() =>
                      setSteers(steers.includes(s) ? steers.filter((x) => x !== s) : [...steers, s])
                    }
                  >
                    {s}
                  </ToggleChip>
                ))}
              </div>
            )
          }
          send
          recording={c.recording}
          onMic={c.mic}
          onAttach={() => c.setAttach(true)}
          onSend={() => go("round2")}
        />
        {stage !== "suggesting" && !c.has && steers.length === 0 && (
          <Label className="mt-2 flex items-center justify-center gap-1.5 text-center text-muted-foreground normal-case tracking-normal">
            <Sparkles className="size-3.5" strokeWidth={2.5} /> Pick above, or steer: the next round comes in
            minutes.
          </Label>
        )}
      </Dock>
      {sheet}
    </>
  );
  return keyboard ? <KeyboardFrame scroll="bottom">{body}</KeyboardFrame> : body;
}
