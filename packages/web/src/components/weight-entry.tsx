import type { WeightEntry } from "@yamt/shared";
import { cn } from "cn";
import { Clock, Undo2 } from "lucide-react";
import { useState } from "react";
import { dayLabel, formatKg, formatTime, fromLocalInput, startOfDay, toLocalInput } from "@/lib/format";
import { useDeleteWeight, useLogWeight } from "@/lib/queries";
import { Band, Label } from "./slab";

/** "81,2" (a German keypad) and "81.2" both mean 81.2 kg; anything else is null. */
export function parseKg(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const kg = Number(t);
  return kg >= 20 && kg <= 500 ? kg : null;
}

/**
 * The quick weight entry, a lime band (design.md: the weight entry wants the user): one field,
 * one tap, measured now unless the time is changed. Right after logging it offers Undo, for a
 * mistyped number; older entries are deleted from the list below.
 */
export function WeightEntryBand({ last, now = Date.now() }: { last: WeightEntry | null; now?: number }) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState<string | null>(null);
  const [logged, setLogged] = useState<WeightEntry | null>(null);
  const log = useLogWeight();
  const remove = useDeleteWeight();
  const kg = parseKg(text);
  const invalid = text.trim() !== "" && kg === null;

  const submit = () => {
    if (kg === null || log.isPending) return;
    const measuredAt = when ? fromLocalInput(when) : null;
    log.mutate(
      { kg, ...(measuredAt !== null ? { measuredAt } : {}) },
      {
        onSuccess: ({ entry }) => {
          setLogged(entry);
          setText("");
          setWhen(null);
        },
      },
    );
  };

  return (
    <Band tone="lime" className="px-5 pt-4 pb-5" data-testid="weight-entry">
      <div className="flex items-end justify-between gap-3">
        <Label className="text-lime-muted">Weight today</Label>
        {last && (
          <Label className="text-right text-lime-muted">
            last {formatKg(last.kg)} kg · {dayLabel(startOfDay(last.measuredAt), now).toLowerCase()}{" "}
            {formatTime(last.measuredAt)}
          </Label>
        )}
      </div>
      <form
        className="mt-3 flex h-[72px] items-stretch gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex min-w-0 flex-1 items-center bg-background pr-3 text-foreground focus-within:bg-lime-soft">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={last ? formatKg(last.kg) : "0.0"}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            aria-label="Weight in kg"
            aria-invalid={invalid}
            className="display h-full min-w-0 flex-1 bg-transparent px-3 text-[40px] outline-none placeholder:text-muted-foreground/40"
          />
          <span className="font-bold text-muted-foreground uppercase">kg</span>
        </label>
        <button
          type="submit"
          disabled={kg === null || log.isPending}
          className={cn(
            "flex h-full w-28 shrink-0 items-center justify-center font-bold text-xl uppercase tracking-wide outline-none",
            "enabled:active:opacity-80 focus-visible:ring-4 focus-visible:ring-foreground/40",
            // ink inside lime stays true black (design.md)
            "bg-lime-foreground text-lime",
            "disabled:bg-tint disabled:text-muted-foreground",
          )}
        >
          {log.isPending ? "…" : "Log"}
        </button>
      </form>
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        {when === null ? (
          <button
            type="button"
            onClick={() => setWhen(toLocalInput(Date.now()))}
            className="-ml-1 flex min-h-11 items-center gap-2 px-1 font-bold text-sm outline-none focus-visible:underline"
          >
            <Clock className="size-4" strokeWidth={2.5} /> Now · change time
          </button>
        ) : (
          <label className="flex min-h-11 flex-1 items-center gap-2 font-bold text-sm">
            <Clock className="size-4 shrink-0" strokeWidth={2.5} />
            <input
              type="datetime-local"
              value={when}
              max={toLocalInput(Date.now())}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Measured at"
              className="h-11 min-w-0 flex-1 bg-background px-2 text-foreground outline-none"
            />
          </label>
        )}
        {invalid && (
          <span className="font-bold text-sm" role="alert">
            Kilograms, like 81.4
          </span>
        )}
      </div>
      {log.isError && (
        <p className="mt-1 font-bold text-sm" role="alert">
          Couldn't log it: {log.error.message}
        </p>
      )}
      {logged && (
        <div
          className="mt-2 flex min-h-11 items-center justify-between gap-3"
          role="status"
          data-testid="logged"
        >
          <span className="font-bold">
            Logged {formatKg(logged.kg)} kg · {formatTime(logged.measuredAt)}
          </span>
          <button
            type="button"
            onClick={() => remove.mutate(logged.id, { onSuccess: () => setLogged(null) })}
            disabled={remove.isPending}
            className="flex h-11 items-center gap-2 bg-background px-3 font-bold text-foreground text-xs uppercase tracking-[0.08em]"
          >
            <Undo2 className="size-4" strokeWidth={2.5} /> Undo
          </button>
        </div>
      )}
    </Band>
  );
}
