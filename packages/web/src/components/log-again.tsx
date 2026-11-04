// Log a meal again (#30): the same cappuccino without another analysis. A top sheet picks the
// portion and the time and copies the meal at once; the Log meal screen lists recent meals to
// pick from ("Again?"). One request, not a capture: offline it fails and says so.
import { REPEAT_FACTORS, type RepeatMealResponse } from "@yamt/shared";
import { Clock, Repeat } from "lucide-react";
import { useState } from "react";
import { formatDayTime, formatNumber, fromLocalInput, toLocalInput } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { repeatError, useRepeatable, useRepeatMeal } from "@/lib/queries";
import { CaptureSheet } from "./add-strip";
import { type ChipOption, Chips } from "./choice";
import { Label, SlabButton, Strip } from "./slab";

/** What gets logged again: the meal, as the sheet shows it. */
export interface RepeatSource {
  mealId: string;
  title: string;
  eatenAt: number;
  /** Its kcal (computed on the server, like every total). */
  kcal: number;
}

const portionName: Record<(typeof REPEAT_FACTORS)[number], string> = {
  0.5: "Half",
  1: "Same",
  1.5: "More",
  2: "Double",
};
const PORTIONS: ChipOption<number>[] = REPEAT_FACTORS.map((f) => ({
  value: f,
  label: portionName[f],
  sub: `${f}×`,
}));

/**
 * The sheet: portion presets (1× by default) and the time (now unless changed), then **Log
 * again**, which creates the copy at once. It slides in from the top like the note and link
 * sheets. `source` null closes it.
 */
export function LogAgainSheet({
  source,
  onClose,
  onLogged,
}: {
  source: RepeatSource | null;
  onClose: () => void;
  onLogged: (r: RepeatMealResponse) => void;
}) {
  // kept while the sheet slides out, so its content doesn't vanish first
  const [shown, setShown] = useState<RepeatSource | null>(source);
  if (source && source !== shown) setShown(source);
  return (
    <CaptureSheet open={source !== null} onClose={onClose} title={shown?.title ?? ""} description="Log again">
      {/* a fresh form (portion, time, client id) every time it opens */}
      {shown && (
        <LogAgainForm
          key={`${shown.mealId}-${source ? "open" : "closed"}`}
          source={shown}
          onLogged={onLogged}
        />
      )}
    </CaptureSheet>
  );
}

function LogAgainForm({
  source,
  onLogged,
}: {
  source: RepeatSource;
  onLogged: (r: RepeatMealResponse) => void;
}) {
  const [factor, setFactor] = useState(1);
  const [when, setWhen] = useState<string | null>(null);
  // one id per opening: a retry after a lost response answers the same copy
  const [id] = useState(() => uuidv7());
  const repeat = useRepeatMeal();
  const at = when === null ? null : fromLocalInput(when);
  const kcal = Math.round(source.kcal * factor);

  const submit = () => {
    if (repeat.isPending || (when !== null && at === null)) return;
    repeat.mutate(
      { sourceId: source.mealId, id, factor, eatenAt: at ?? Date.now() },
      { onSuccess: onLogged },
    );
  };

  return (
    <div data-testid="log-again">
      <div className="px-5">
        <Label className="text-muted-foreground">
          {formatDayTime(source.eatenAt)} · {formatNumber(source.kcal)} kcal
        </Label>
        <p className="mt-1 font-medium text-muted-foreground text-sm">
          Its items are copied, scaled to the portion: no new analysis.
        </p>
      </div>
      <div className="px-5 pt-4 pb-5">
        <Label className="mb-2 text-muted-foreground">Portion</Label>
        <Chips label="Portion" options={PORTIONS} value={factor} onChange={setFactor} />
        <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
          {when === null ? (
            <button
              type="button"
              onClick={() => setWhen(toLocalInput(Date.now()))}
              className="-ml-1 flex min-h-11 items-center gap-2 px-1 font-bold text-sm outline-none focus-visible:underline"
            >
              <Clock className="size-4" strokeWidth={2.5} /> Now · change time
            </button>
          ) : (
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-bold text-sm">
              <Clock className="size-4 shrink-0" strokeWidth={2.5} />
              <input
                type="datetime-local"
                value={when}
                max={toLocalInput(Date.now())}
                onChange={(e) => setWhen(e.target.value)}
                aria-label="Eaten at"
                className="h-11 min-w-0 flex-1 bg-tint px-2 outline-none focus:bg-lime-soft"
              />
            </label>
          )}
          <div className="shrink-0 text-right" data-testid="log-again-kcal">
            <span className="display text-[28px]">
              {factor === 1 ? "" : "≈ "}
              {formatNumber(kcal)}
            </span>
            <Label className="text-[10px] text-muted-foreground">kcal</Label>
          </div>
        </div>
      </div>
      {repeat.isError && (
        <Label
          className="bg-orange px-5 py-2.5 text-orange-foreground normal-case tracking-normal"
          role="alert"
        >
          {repeatError(repeat.error)}
        </Label>
      )}
      <SlabButton onClick={submit} disabled={repeat.isPending || (when !== null && at === null)}>
        <Repeat className="size-7" strokeWidth={2.5} /> {repeat.isPending ? "Logging…" : "Log again"}
      </SlabButton>
    </div>
  );
}

/**
 * "Again?" on the Log meal screen: recent analysed meals (30 days, one per title, the most often
 * logged first), each with its kcal; a tap opens the sheet. Nothing when there are none (or the
 * server can't be reached).
 */
export function AgainList({ onPick }: { onPick: (s: RepeatSource) => void }) {
  const q = useRepeatable();
  const meals = q.data?.meals ?? [];
  if (meals.length === 0) return null;
  return (
    <section aria-label="Log again" data-testid="again">
      <Strip title="Again?" meta="last 30 days" />
      <ul className="divide-y divide-border">
        {meals.map((m) => (
          <li key={m.mealId}>
            <button
              type="button"
              onClick={() =>
                onPick({
                  mealId: m.mealId,
                  title: m.title,
                  eatenAt: m.eatenAt,
                  kcal: m.totals.nutrients.energyKcal,
                })
              }
              className="flex min-h-[68px] w-full items-center gap-4 px-5 py-3 text-left outline-none active:bg-tint focus-visible:bg-tint"
              data-testid="again-row"
            >
              <span className="min-w-0 flex-1">
                <span className="display block truncate text-[19px] leading-[1.05] tracking-[-0.02em]">
                  {m.title}
                </span>
                <span className="mt-1 block font-medium text-muted-foreground text-xs">
                  {m.times > 1 ? `${m.times}× in 30 days · ` : ""}
                  {formatDayTime(m.eatenAt)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="display block text-[26px]">
                  {formatNumber(m.totals.nutrients.energyKcal)}
                </span>
                <Label className="text-[10px] text-muted-foreground">kcal</Label>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
