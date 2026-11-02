import { cn } from "cn";
import type { MealStatus, Provenance } from "@/design/mock";
import { provenanceLabel } from "@/design/mock";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-bold text-xs uppercase tracking-[0.08em]", className)}>{children}</div>;
}

/** Status as a solid stamp. Lime wants the user, orange is broken, outline is in progress. */
export function Stamp({ status }: { status: MealStatus }) {
  const base =
    "inline-flex h-7 items-center border-[3px] border-foreground px-2 font-bold text-xs uppercase tracking-wide";
  switch (status) {
    case "needs_input":
      return <span className={cn(base, "bg-(--lime) text-foreground")}>Needs input</span>;
    case "analysing":
      return (
        <span className={cn(base, "bg-background")}>
          <span className="mr-1.5 size-2 animate-pulse bg-foreground" /> Analysing
        </span>
      );
    case "failed":
      return <span className={cn(base, "border-(--orange) bg-(--orange) text-background")}>Failed</span>;
    case "draft":
      return <span className={cn(base, "border-dashed bg-background text-muted-foreground")}>Draft</span>;
    default:
      return <span className={cn(base, "bg-foreground text-background")}>Done</span>;
  }
}

export function ProvenanceStamp({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center border-2 border-foreground px-1.5 font-bold text-[10px] uppercase tracking-wide",
        provenance === "estimate"
          ? "bg-(--lime)"
          : provenance === "weighed"
            ? "bg-foreground text-background"
            : "",
      )}
    >
      {provenanceLabel[provenance]}
    </span>
  );
}

/** A fat bar with a border; the fill is black, over-goal spills in orange. */
export function FatBar({ value, goal, className }: { value: number; goal: number; className?: string }) {
  const p = Math.min(100, (value / goal) * 100);
  return (
    <div className={cn("brick-flat h-4 w-full bg-background", className)}>
      <div className="h-full bg-foreground" style={{ width: `${p}%` }} />
    </div>
  );
}

export function BigButton({
  children,
  className,
  tone = "lime",
  ...props
}: React.ComponentProps<"button"> & { tone?: "lime" | "ink" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "brick flex h-16 w-full items-center justify-center gap-3 font-bold text-xl uppercase tracking-wide active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60",
        tone === "lime" && "bg-(--lime) text-foreground",
        tone === "ink" && "bg-foreground text-background",
        tone === "ghost" && "bg-background text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
