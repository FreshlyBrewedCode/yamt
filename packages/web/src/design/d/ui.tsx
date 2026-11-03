import { cn } from "cn";
import type { MealStatus, Provenance } from "@/design/mock";
import { provenanceLabel } from "@/design/mock";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-bold text-xs uppercase tracking-[0.08em]", className)}>{children}</div>;
}

/** A full-bleed band. The fill carries the hierarchy: ink for the one thing, lime for "wants you",
 *  tint for secondary content, plain for lists. */
export function Band({
  tone = "plain",
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { tone?: "plain" | "ink" | "lime" | "tint" | "orange" }) {
  return (
    <section
      className={cn(
        tone === "ink" && "band-ink",
        tone === "lime" && "band-lime",
        tone === "tint" && "band-tint",
        tone === "orange" && "band-orange",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

/** Section heading as a quiet tinted strip: title left, meta right. */
export function Strip({ title, meta, className }: { title: string; meta?: string; className?: string }) {
  return (
    <div className={cn("band-tint flex items-end justify-between px-5 pt-4 pb-2", className)}>
      <h2 className="display text-[22px]">{title}</h2>
      {meta && <Label className="text-muted-foreground">{meta}</Label>}
    </div>
  );
}

/** Status as a plain micro-label; the row's fill does the shouting (lime needs you, orange failed). */
export function Status({ status, className }: { status: MealStatus; className?: string }) {
  const base = "inline-flex items-center gap-1.5 font-bold text-xs uppercase tracking-[0.08em]";
  switch (status) {
    case "needs_input":
      return <span className={cn(base, className)}>Needs input</span>;
    case "analysing":
      return (
        <span className={cn(base, "text-muted-foreground", className)}>
          <span className="size-2 animate-pulse bg-current" /> Analysing
        </span>
      );
    case "failed":
      return <span className={cn(base, className)}>Failed</span>;
    case "draft":
      return <span className={cn(base, "text-muted-foreground", className)}>Draft</span>;
    default:
      return <span className={cn(base, "text-muted-foreground", className)}>Analysed</span>;
  }
}

export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  const marker =
    provenance === "weighed"
      ? "bg-foreground"
      : provenance === "estimate"
        ? "bg-(--lime) outline outline-1 outline-foreground/40"
        : provenance === "label"
          ? "bg-foreground/50"
          : "border-2 border-foreground/60";
  return (
    <span className="inline-flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-[0.08em]">
      <span className={cn("size-2.5", marker)} />
      {provenanceLabel[provenance]}
    </span>
  );
}

/** A progress bar without a frame: a track in a quieter version of the band's foreground. */
export function Bar({
  value,
  goal,
  className,
  track = "bg-current/20",
  fill = "bg-current",
}: {
  value: number;
  goal: number;
  className?: string;
  track?: string;
  fill?: string;
}) {
  const p = Math.min(100, (value / goal) * 100);
  return (
    <div className={cn("h-2 w-full", track, className)}>
      <div className={cn("h-full", fill)} style={{ width: `${p}%` }} />
    </div>
  );
}

export function BlockButton({
  children,
  className,
  tone = "lime",
  ...props
}: React.ComponentProps<"button"> & { tone?: "lime" | "ink" | "ghost" }) {
  // band-* is unlayered CSS and would beat a disabled: variant, so a disabled button gets no band
  const fill = props.disabled ? "muted" : tone;
  return (
    <button
      type="button"
      className={cn(
        "flex h-16 w-full items-center justify-center gap-3 font-bold text-xl uppercase tracking-wide active:opacity-80",
        fill === "lime" && "band-lime",
        fill === "ink" && "band-ink",
        fill === "ghost" && "bg-transparent text-current",
        fill === "muted" && "band-tint text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
