// Variant E · Form: the field at the top under "What do you fancy?", Attach and Speak as two tint
// halves under it, the request as the agent reads it (ink, one sentence from the filters), the
// structured filters on tint, the starters at the end; Suggest is the lime bottom slab and stays
// above the keyboard. In a thread the same form sits at the end as Steer.
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Band, BottomSlab, Label, SlabButton, Strip } from "@/components/slab";
import { Header } from "../shared";
import type { Screen2 } from "../variants";
import { type Ctx, Frame } from "./frame";
import {
  ATTACHED,
  AttachSheet,
  Composer,
  FilterGroups,
  KeyboardFrame,
  REQUEST_FILTERS,
  requestSentence,
  STARTERS,
  STEER_TYPED,
  STEERS,
  StarterRow,
  Thread,
  ToggleChip,
  TYPED,
  useComposer,
} from "./parts";

export function PlanE({ screen, go }: { screen: Screen2; go: (s: Screen2) => void }) {
  return <Frame screen={screen} go={go} compose={(ctx) => <ComposeE ctx={ctx} />} />;
}

function ComposeE({ ctx }: { ctx: Ctx }) {
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
    const parts = [
      c.text && "what you typed",
      c.attachments.some((a) => a.kind === "voice") && "what you said",
      c.attachments.some((a) => a.kind !== "voice") && "what you attached",
    ].filter(Boolean);
    const body = (
      <>
        <Header label="Plan" title="What do you fancy?" onBack={() => go("overview")} />
        <main className="flex-1">
          <Composer
            size="tall"
            text={c.text}
            placeholder="Leftovers, a mood, a link, which days…"
            focused={keyboard}
            attachments={c.attachments}
            recording={c.recording}
            onMic={c.mic}
            onAttach={() => c.setAttach(true)}
            className="pb-4"
          />
          <Band tone="ink" className="px-5 pt-4 pb-5">
            <Label className="text-ink-muted">Asking for</Label>
            <div className="display mt-2 text-[24px] leading-[1.05] tracking-[-0.03em]">
              {requestSentence(c.filters)}
            </div>
            <p className="mt-2 font-medium text-ink-muted text-sm leading-snug">
              {parts.length ? `Plus ${parts.join(", ")}. ` : ""}The agent adds your goal, the last 10 days and
              what's in the fridge.
            </p>
          </Band>
          <Band tone="tint" className="pt-4 pb-5">
            <FilterGroups filters={c.filters} onChange={c.setFilters} surface="tint" />
          </Band>
          <Strip title="Or start from" meta="from your days" />
          <ul className="divide-y divide-border">
            {STARTERS.map((s) => (
              <StarterRow key={s.id} s={s} onPick={c.pickStarter} />
            ))}
          </ul>
        </main>
        <BottomSlab
          hint={c.has ? undefined : "Filters alone are enough: the agent fills in the rest from your days."}
        >
          <SlabButton onClick={() => go("suggesting")}>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggest
          </SlabButton>
        </BottomSlab>
        {sheet}
      </>
    );
    return keyboard ? <KeyboardFrame>{body}</KeyboardFrame> : body;
  }

  const stage = screen === "suggesting" ? "suggesting" : screen === "round2" ? "round2" : "round1";
  const ready = c.has || steers.length > 0;
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
          stage !== "suggesting" && (
            <>
              <Strip title="Steer" meta="adds a round" />
              <div className="flex flex-wrap gap-0.5 px-5 pt-3 pb-3">
                {STEERS.map((s) => (
                  <ToggleChip
                    key={s}
                    on={steers.includes(s)}
                    onClick={() =>
                      setSteers(steers.includes(s) ? steers.filter((x) => x !== s) : [...steers, s])
                    }
                  >
                    {s}
                  </ToggleChip>
                ))}
              </div>
              <Composer
                size="tall"
                text={c.text}
                placeholder="Or say what to change…"
                focused={keyboard}
                attachments={c.attachments}
                recording={c.recording}
                onMic={c.mic}
                onAttach={() => c.setAttach(true)}
                className="pb-4"
              />
            </>
          )
        }
      />
      <BottomSlab
        hint={
          stage === "suggesting"
            ? "You can leave: a push arrives when it's done."
            : ready
              ? undefined
              : "Pick above, or say what to change."
        }
      >
        {stage === "suggesting" ? (
          <SlabButton tone="tint" disabled>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggesting…
          </SlabButton>
        ) : (
          <SlabButton disabled={!ready} onClick={() => go("round2")}>
            <Sparkles className="size-7" strokeWidth={2.5} /> Suggest again
          </SlabButton>
        )}
      </BottomSlab>
      {sheet}
    </>
  );
  return keyboard ? <KeyboardFrame scroll="bottom">{body}</KeyboardFrame> : body;
}
