import { cn } from "cn";
import { AlertCircle, CircleHelp, Loader2 } from "lucide-react";
import type { MealStatus, Provenance } from "@/design/mock";
import { provenanceLabel } from "@/design/mock";

/** Small caps label, the journal's section marker. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]", className)}
    >
      {children}
    </div>
  );
}

export function Rule({ className }: { className?: string }) {
  return <hr className={cn("border-border border-t", className)} />;
}

export function Status({ status, detail }: { status: MealStatus; detail?: string }) {
  switch (status) {
    case "needs_input":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-(--attention) text-xs">
          <CircleHelp className="size-3.5" /> Needs input{detail ? ` · ${detail}` : ""}
        </span>
      );
    case "analysing":
      return (
        <span className="inline-flex items-center gap-1 text-accent text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Analysing…
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-destructive text-xs">
          <AlertCircle className="size-3.5" /> Failed · tap to retry
        </span>
      );
    case "draft":
      return <span className="text-muted-foreground text-xs">Draft · {detail}</span>;
    default:
      return <span className="text-muted-foreground text-xs">{detail}</span>;
  }
}

export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  const estimate = provenance === "estimate";
  return (
    <span
      className={cn(
        "rounded-xs border px-1 py-px font-medium text-[10px] uppercase tracking-wider",
        estimate ? "border-(--attention) text-(--attention)" : "border-border text-muted-foreground",
      )}
    >
      {provenanceLabel[provenance]}
    </span>
  );
}

/** Confidence as five hairline ticks. */
export function Confidence({ value }: { value: number }) {
  const filled = Math.round(value * 5);
  return (
    <span
      className="inline-flex items-end gap-px"
      role="img"
      aria-label={`confidence ${Math.round(value * 100)}%`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-[3px]",
            i < filled ? (value < 0.6 ? "bg-(--attention)" : "bg-accent") : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

export function Bar({
  value,
  goal,
  tone = "accent",
}: {
  value: number;
  goal: number;
  tone?: "accent" | "ink";
}) {
  const p = Math.min(100, (value / goal) * 100);
  return (
    <div className="h-[3px] w-full bg-border">
      <div
        className={cn("h-full", tone === "accent" ? "bg-accent" : "bg-foreground")}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}
