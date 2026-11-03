// The D · Slab primitives (docs/design/design.md): full-bleed bands told apart by fill, the
// micro-label, section strips, block buttons and the sticky bottom slab.
import type { MealStatus } from "@yamt/shared";
import { cn } from "cn";
import type * as React from "react";

/** The uppercase micro-label: what a number is, section meta, statuses. */
export function Label({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("font-bold text-xs uppercase tracking-[0.08em]", className)} {...props} />;
}

export type Tone = "plain" | "ink" | "lime" | "tint" | "orange";

export const toneClass: Record<Tone, string> = {
  plain: "",
  ink: "bg-ink text-ink-foreground",
  lime: "bg-lime text-lime-foreground",
  tint: "bg-tint",
  orange: "bg-orange text-orange-foreground",
};

/**
 * A full-bleed band. Ink for the one thing on the screen, lime for whatever wants the user,
 * tint for secondary content, plain for lists, orange only for failure.
 */
export function Band({
  tone = "plain",
  className,
  ...props
}: React.ComponentProps<"section"> & { tone?: Tone }) {
  return <section className={cn(toneClass[tone], className)} {...props} />;
}

/** A section header on tint: title left, meta right. */
export function Strip({
  title,
  meta,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between bg-tint px-5 pt-4 pb-2", className)}>
      <h2 className="display text-[22px]">{title}</h2>
      {meta !== undefined && <Label className="text-muted-foreground">{meta}</Label>}
    </div>
  );
}

/** A full-width block button. Disabled is tint with muted text, never a dimmed lime. */
export function SlabButton({
  tone = "lime",
  className,
  ...props
}: React.ComponentProps<"button"> & { tone?: "lime" | "ink" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-16 w-full items-center justify-center gap-3 font-bold text-xl uppercase tracking-wide",
        "outline-none focus-visible:ring-4 focus-visible:ring-foreground/40 focus-visible:ring-inset",
        "enabled:active:opacity-80 disabled:bg-tint disabled:text-muted-foreground",
        tone === "lime" && "bg-lime text-lime-foreground",
        // "ink inside lime" stays true black in dark mode too: lime-foreground, not the charcoal ink
        tone === "ink" && "bg-ink text-ink-foreground",
        tone === "ghost" && "bg-transparent text-current",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The screen's main action, sticky at the bottom of the column and part of the layout (nothing
 * floats over the list). Its fill runs through the home-indicator inset; `hint` explains why
 * the action waits.
 */
export function BottomSlab({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10">
      {hint && (
        <Label
          className="bg-tint px-5 py-2.5 text-center text-muted-foreground normal-case tracking-normal"
          role="status"
        >
          {hint}
        </Label>
      )}
      <div className="[&>*]:h-[calc(76px+env(safe-area-inset-bottom))] [&>*]:pb-[env(safe-area-inset-bottom)] [&>*]:text-2xl">
        {children}
      </div>
    </footer>
  );
}

/** A 48 px tint square for header actions (close, back). */
export const iconButtonClass =
  "flex size-12 shrink-0 items-center justify-center bg-tint outline-none active:opacity-70 focus-visible:ring-4 focus-visible:ring-foreground/30";

/** Screens without a bottom slab end clear of the home indicator. */
export function SafeBottom() {
  return <div className="h-[max(2rem,env(safe-area-inset-bottom))]" />;
}

const statusText: Record<MealStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  analysing: "Analysing",
  analysed: "Analysed",
  needs_input: "Needs input",
  failed: "Failed",
};

/** Status as a plain micro-label; the row's fill does the shouting (lime: needs you, orange: failed). */
export function StatusLabel({ status, className }: { status: MealStatus; className?: string }) {
  const loud = status === "needs_input" || status === "failed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold text-xs uppercase tracking-[0.08em]",
        !loud && "text-muted-foreground",
        className,
      )}
      data-status={status}
    >
      {(status === "analysing" || status === "queued") && (
        <span className={cn("size-2 bg-current", status === "analysing" && "animate-pulse")} />
      )}
      {statusText[status]}
    </span>
  );
}
