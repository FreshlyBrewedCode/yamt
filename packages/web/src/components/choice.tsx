// Picking instead of typing (#24): large choice rows, preset chips, a stepper, a percent slider
// and the macro split bar. Selection is a fact, not a call to action, so it is never lime: a
// selected row shows a filled square check (its row stays plain, so it never merges with a tint
// strip above it), a selected chip takes the foreground fill (like the switch).
import { cn } from "cn";
import { Check, Minus, Plus } from "lucide-react";
import type * as React from "react";
import { Label } from "./slab";

/** A square switch: foreground when on, tint when off (lime stays for what wants the user). */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-14 shrink-0 items-center p-1 transition-colors",
        on ? "bg-foreground" : "bg-tint",
      )}
    >
      <span
        className={cn(
          "size-6 transition-transform",
          on ? "translate-x-6 bg-background" : "translate-x-0 bg-muted-foreground",
        )}
      />
    </span>
  );
}

/** The square check of a choice row (the goals screen's "Fix a typo" toggle uses the same). */
export function CheckSquare({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center",
        on ? "bg-foreground text-background" : "bg-tint",
        className,
      )}
    >
      {on && <Check className="size-5" strokeWidth={3} />}
    </span>
  );
}

/**
 * One option of a single choice, as a full-width row (≥ 72 px): the title bold, one line of
 * example under it, the check on the right. Rows stack with dividers in a `ChoiceList`; each is a toggle button (`aria-pressed`).
 * A disabled row is muted without a square, unless it is the chosen one (a choice fixed elsewhere).
 */
export function ChoiceRow({
  title,
  detail,
  selected,
  onSelect,
  disabled = false,
  className,
  ...props
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
} & Omit<React.ComponentProps<"button">, "title" | "onSelect">) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-[72px] w-full items-center gap-4 px-5 py-3 text-left outline-none",
        "focus-visible:underline disabled:text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-[17px] leading-tight">{title}</span>
        {detail && (
          <span className="mt-0.5 block font-medium text-muted-foreground text-sm leading-snug">
            {detail}
          </span>
        )}
      </span>
      {(!disabled || selected) && <CheckSquare on={selected} />}
    </button>
  );
}

/** A stack of choice rows with dividers. */
export function ChoiceList({
  label,
  children,
  className,
  ...props
}: { label: string } & React.ComponentProps<"fieldset">) {
  return (
    <fieldset aria-label={label} className={cn("min-w-0 divide-y divide-border", className)} {...props}>
      {children}
    </fieldset>
  );
}

export interface ChipOption<T> {
  value: T;
  /** The micro-label (under the number): "High", "Gentle". */
  label: string;
  /** The number: "2.0", "0.5 %". */
  sub?: React.ReactNode;
}

/**
 * Preset chips: equal cells in one row, 56 px (64 with a number), tint; the chosen one in the
 * foreground fill. For the presets the user picks from instead of typing a number. More than
 * five wrap into two rows (six efforts don't fit one row at 390 px).
 */
export function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
  ...props
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Fixed elsewhere: the chosen chip stays visible, nothing can be pressed, the rest is muted. */
  disabled?: boolean;
} & Omit<React.ComponentProps<"fieldset">, "onChange">) {
  return (
    <fieldset aria-label={label} disabled={disabled} className={cn("min-w-0", className)} {...props}>
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${options.length > 5 ? Math.ceil(options.length / 2) : options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center px-1 outline-none focus-visible:underline",
                o.sub !== undefined ? "h-16" : "h-14",
                on ? "bg-foreground text-background" : "bg-tint",
                disabled && !on && "text-muted-foreground",
              )}
            >
              {o.sub !== undefined && <span className="display text-[20px]">{o.sub}</span>}
              <Label
                className={cn(
                  "max-w-full truncate text-[11px] tracking-[0.06em]",
                  o.sub !== undefined && "mt-1",
                )}
              >
                {o.label}
              </Label>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** − 3 +: whole numbers within [min, max] in 64 px tint squares around a display number. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  /** For screen readers: "Sessions per week". */
  label: string;
  unit: React.ReactNode;
}) {
  const square =
    "flex size-16 shrink-0 items-center justify-center bg-tint outline-none active:opacity-70 focus-visible:ring-4 focus-visible:ring-foreground/30 disabled:text-muted-foreground/40";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={square}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Fewer: ${label}`}
      >
        <Minus className="size-7" strokeWidth={2.5} />
      </button>
      <div className="flex-1 text-center" aria-live="polite">
        <div className="display text-[64px]" data-testid="stepper-value">
          <span className="sr-only">{label}: </span>
          {value}
        </div>
        <Label className="mt-1 text-muted-foreground">{unit}</Label>
      </div>
      <button
        type="button"
        className={square}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`More: ${label}`}
      >
        <Plus className="size-7" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** A percent slider in steps, with the stops labelled under the track. */
export function PercentSlider({
  value,
  min,
  max,
  step,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const stops: number[] = [];
  for (let n = min; n <= max; n += step) stops.push(n);
  return (
    <div>
      <input
        type="range"
        className="slab-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={`${value} %`}
      />
      <div className="flex justify-between">
        {stops.map((n) => (
          <Label
            key={n}
            className={cn("w-8 text-center", n === value ? "text-foreground" : "text-muted-foreground")}
          >
            {n}
          </Label>
        ))}
      </div>
    </div>
  );
}

export interface SplitPart {
  key: string;
  label: string;
  /** 0–1 of the energy. */
  share: number;
  /** A fill class on the ink slab. */
  fill: string;
}

/**
 * The macro split on the ink slab: one 12 px bar, a segment per macro (share of kcal) with 2 px
 * gaps in the slab's colour. The legend underneath carries the same swatches and the numbers,
 * so it never relies on the fills alone.
 */
export function SplitBar({ parts, className }: { parts: readonly SplitPart[]; className?: string }) {
  const total = parts.reduce((s, p) => s + p.share, 0) || 1;
  return (
    <div
      className={cn("flex h-3 w-full gap-0.5", className)}
      role="img"
      aria-label={`Split of energy: ${parts.map((p) => `${p.label} ${Math.round(p.share * 100)} %`).join(", ")}`}
      data-testid="split-bar"
    >
      {parts.map((p) => (
        <div
          key={p.key}
          className={cn("h-full transition-[width]", p.fill)}
          style={{ width: `${(p.share / total) * 100}%` }}
        />
      ))}
    </div>
  );
}
