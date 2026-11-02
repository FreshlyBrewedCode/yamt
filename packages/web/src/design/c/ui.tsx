import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { AlertCircle, Check, CircleHelp, Loader2, Pencil, Plus, Target, UtensilsCrossed } from "lucide-react";
import type { MealStatus, Provenance } from "@/design/mock";
import { provenanceLabel } from "@/design/mock";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-2">
      <h2 className="display text-lg">{children}</h2>
      {aside && <span className="font-semibold text-muted-foreground text-sm">{aside}</span>}
    </div>
  );
}

export function Chip({ status }: { status: MealStatus }) {
  const base = "inline-flex h-6 items-center gap-1 rounded-full px-2 font-bold text-xs";
  switch (status) {
    case "needs_input":
      return (
        <span className={cn(base, "bg-(--amber-soft) text-foreground")}>
          <CircleHelp className="size-3.5 text-(--amber)" strokeWidth={2.5} /> Needs input
        </span>
      );
    case "analysing":
      return (
        <span className={cn(base, "bg-(--sage-soft) text-accent")}>
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2.5} /> Analysing
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-(--coral-soft) text-destructive")}>
          <AlertCircle className="size-3.5" strokeWidth={2.5} /> Failed
        </span>
      );
    case "draft":
      return (
        <span className={cn(base, "bg-muted text-muted-foreground")}>
          <Pencil className="size-3" strokeWidth={2.5} /> Draft
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-(--sage-soft) text-accent")}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      );
  }
}

const provenanceTone: Record<Provenance, string> = {
  weighed: "bg-(--sage-soft) text-accent",
  label: "bg-(--blue-soft) text-(--blue)",
  database: "bg-muted text-muted-foreground",
  estimate: "bg-(--amber-soft) text-foreground",
};

export function ProvenancePill({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 font-bold text-[11px]",
        provenanceTone[provenance],
      )}
    >
      {provenanceLabel[provenance]}
    </span>
  );
}

/** A progress ring: kcal in the middle, the goal as the track. */
export function Ring({
  value,
  goal,
  size = 120,
  stroke = 12,
  children,
}: {
  value: number;
  goal: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, value / goal);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`${Math.round(p * 100)}%`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function SoftBar({ value, goal, tone = "primary" }: { value: number; goal: number; tone?: string }) {
  const p = Math.min(100, (value / goal) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: tone }} />
    </div>
  );
}

/** Bottom tab bar with the Log meal pill floating in the middle. */
export function TabBar({ active, dir = "c" }: { active: "meals" | "goals"; dir?: string }) {
  return (
    <footer className="fixed inset-x-0 bottom-0 mx-auto max-w-md">
      <div className="relative mx-4 mb-5 flex h-[68px] items-center justify-around rounded-[34px] border border-border bg-card/85 shadow-[0_8px_30px_-10px_oklch(0.3_0.03_160/0.25)] backdrop-blur-xl">
        <Link
          to={`/design/${dir}` as never}
          className={cn(
            "flex w-24 flex-col items-center gap-0.5 font-bold text-xs",
            active === "meals" ? "text-primary" : "text-muted-foreground",
          )}
        >
          <UtensilsCrossed className="size-6" strokeWidth={2.5} />
          Meals
        </Link>
        <Link
          to={`/design/${dir}/log` as never}
          className="-mt-9 flex size-[72px] flex-col items-center justify-center gap-0 rounded-full bg-primary text-primary-foreground shadow-[0_10px_24px_-6px_var(--primary)] active:scale-95"
          aria-label="Log meal"
        >
          <Plus className="size-8" strokeWidth={3} />
          <span className="font-bold text-[11px]">Log meal</span>
        </Link>
        <Link
          to={`/design/${dir}/goals` as never}
          className={cn(
            "flex w-24 flex-col items-center gap-0.5 font-bold text-xs",
            active === "goals" ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Target className="size-6" strokeWidth={2.5} />
          Goals
        </Link>
      </div>
    </footer>
  );
}
