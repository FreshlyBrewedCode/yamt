// Variant F · Starters: the starters are the screen, each a full-width band carrying its number
// (the first, what's open tonight, is the ink slab). A tap fills the compact composer in the
// bottom slab and the scope row above it (Tonight · dinner · any time, opening the filters as a
// top sheet); Suggest is lime under it. Steering gets the same slab with steer chips.
import { cn } from "cn";
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { CaptureSheet } from "@/components/add-strip";
import { Label, SlabButton } from "@/components/slab";
import { Header } from "../shared";
import type { Screen2 } from "../variants";
import { type Ctx, Frame } from "./frame";
import {
  ATTACHED,
  AttachSheet,
  Composer,
  FilterGroups,
  filterWords,
  KeyboardFrame,
  REQUEST_FILTERS,
  STARTERS,
  STEER_TYPED,
  STEERS,
  type Starter,
  Thread,
  ToggleChip,
  useComposer,
} from "./parts";

export function PlanF({ screen, go }: { screen: Screen2; go: (s: Screen2) => void }) {
  return <Frame screen={screen} go={go} compose={(ctx) => <ComposeF ctx={ctx} />} />;
}

/** A starter as a band: the number big on the left, the prompt and its why on the right. */
function StarterBand({
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

const TONES: ("ink" | "tint" | "plain")[] = ["ink", "tint", "plain", "tint", "plain", "tint"];

/** The footer: an optional row above the composer, the composer, then the 76 px slab. */
function Slab({
  above,
  composer,
  button,
}: {
  above?: React.ReactNode;
  composer: React.ReactNode;
  button: React.ReactNode;
}) {
  return (
    <footer className="sticky bottom-0 z-10 bg-background">
      {above}
      <div className="py-2">{composer}</div>
      <div className="[&>*]:h-[calc(76px+env(safe-area-inset-bottom))] [&>*]:pb-[env(safe-area-inset-bottom)] [&>*]:text-2xl">
        {button}
      </div>
    </footer>
  );
}

function ComposeF({ ctx }: { ctx: Ctx }) {
  const { screen, go } = ctx;
  const inThread =
    screen === "suggesting" || screen === "suggestions" || screen === "steer" || screen === "round2";
  const pumpkin = STARTERS[1]!;
  const c = useComposer(
    screen === "typing"
      ? {
          text: pumpkin.text,
          filters: { ...REQUEST_FILTERS, when: "tonight", days: [], time: "any", constraints: [] },
        }
      : screen === "attached"
        ? { text: pumpkin.text, attachments: ATTACHED.slice(0, 2), filters: REQUEST_FILTERS }
        : screen === "steer"
          ? { text: STEER_TYPED }
          : {},
  );
  const [scope, setScope] = useState(false);
  const [steers, setSteers] = useState<string[]>(screen === "steer" ? ["Faster"] : []);
  const keyboard = screen === "typing" || screen === "steer";
  const sheets = (
    <>
      <AttachSheet open={c.attach} onClose={() => c.setAttach(false)} />
      <CaptureSheet open={scope} onClose={() => setScope(false)} title="Scope" description="For this request">
        <div className="bg-tint pt-4 pb-5">
          <FilterGroups filters={c.filters} onChange={c.setFilters} surface="tint" />
        </div>
        <SlabButton tone="tint" onClick={() => setScope(false)}>
          Done
        </SlabButton>
      </CaptureSheet>
    </>
  );

  if (!inThread) {
    const words = filterWords(c.filters);
    const body = (
      <>
        <Header label="Plan · Tue 4 Nov" title="Start from" onBack={() => go("overview")} />
        <main className="flex-1">
          <ul className="divide-y divide-border">
            {STARTERS.map((s, i) => (
              <StarterBand key={s.id} s={s} tone={TONES[i] ?? "plain"} onPick={c.pickStarter} />
            ))}
          </ul>
        </main>
        <Slab
          above={
            <button
              type="button"
              onClick={() => setScope(true)}
              className="flex h-12 w-full items-center gap-3 bg-tint px-5 text-left active:opacity-70"
            >
              <Label className="shrink-0 text-muted-foreground">Scope</Label>
              <span className="min-w-0 flex-1 truncate font-bold text-sm">{words.join(" · ")}</span>
              <ChevronDown className="size-5 shrink-0" strokeWidth={2.5} />
            </button>
          }
          composer={
            <Composer
              text={c.text}
              placeholder="Or say it yourself…"
              focused={keyboard}
              attachments={c.attachments}
              recording={c.recording}
              onMic={c.mic}
              onAttach={() => c.setAttach(true)}
            />
          }
          button={
            <SlabButton disabled={!c.has} onClick={() => go("suggesting")}>
              <Sparkles className="size-7" strokeWidth={2.5} /> Suggest
            </SlabButton>
          }
        />
        {sheets}
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
      />
      <Slab
        above={
          stage !== "suggesting" && (
            <div className="flex gap-0.5 overflow-x-auto bg-tint px-5 py-2 [scrollbar-width:none]">
              {STEERS.map((s) => (
                <ToggleChip
                  key={s}
                  on={steers.includes(s)}
                  surface="tint"
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
        composer={
          <Composer
            text={c.text}
            placeholder={stage === "suggesting" ? "Add more for the next round…" : "Or say what to change…"}
            focused={keyboard}
            attachments={c.attachments}
            recording={c.recording}
            onMic={c.mic}
            onAttach={() => c.setAttach(true)}
          />
        }
        button={
          stage === "suggesting" ? (
            <SlabButton tone="tint" disabled>
              <Sparkles className="size-7" strokeWidth={2.5} /> Suggesting…
            </SlabButton>
          ) : (
            <SlabButton disabled={!ready} onClick={() => go("round2")}>
              <Sparkles className="size-7" strokeWidth={2.5} /> Suggest again
            </SlabButton>
          )
        }
      />
      {sheets}
    </>
  );
  return keyboard ? <KeyboardFrame scroll="bottom">{body}</KeyboardFrame> : body;
}
