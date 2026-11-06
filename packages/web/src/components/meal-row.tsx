import { Link } from "@tanstack/react-router";
import type { MealStatus, MealSummary } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import { captureSummary, formatNumber, formatTime, plural, startOfDay } from "@/lib/format";
import type { OutboxEntry } from "@/lib/outbox";
import { Label, StatusLabel } from "./slab";

/** A meal in a list (the overview, a day): the server's, or one that exists only on this phone so far. */
export interface MealRowData {
  id: string;
  eatenAt: number;
  status: MealStatus;
  meal: MealSummary | null;
  /** Captures still on this phone. */
  pending: number;
  /** An upload the server refused. */
  refused: boolean;
}

/**
 * Days, newest first, with their meals: the server's, plus meals that exist only on this phone so
 * far (started offline). Empty drafts (opened, nothing captured) are left out; a meal logged again
 * (#30) or from the plan (#40) has no captures but its revision, and counts like any other.
 */
export function groupByDay(meals: MealSummary[], entries: readonly OutboxEntry[]) {
  const rows = new Map<string, MealRowData>();
  for (const m of meals) {
    rows.set(m.id, { id: m.id, eatenAt: m.eatenAt, status: m.status, meal: m, pending: 0, refused: false });
  }
  for (const e of entries) {
    if (e.type !== "capture") continue;
    const row: MealRowData = rows.get(e.mealId) ?? {
      id: e.mealId,
      eatenAt: e.capturedAt,
      status: "draft" as const,
      meal: null,
      pending: 0,
      refused: false,
    };
    row.pending++;
    row.refused ||= e.failed;
    if (!row.meal) row.eatenAt = Math.min(row.eatenAt, e.capturedAt);
    rows.set(e.mealId, row);
  }
  const byDay = new Map<number, MealRowData[]>();
  for (const r of rows.values()) {
    if (r.meal && r.meal.captureCount === 0 && r.meal.currentRevisionId === null && r.pending === 0) continue;
    const start = startOfDay(r.eatenAt);
    byDay.set(start, [...(byDay.get(start) ?? []), r]);
  }
  return [...byDay]
    .sort(([a], [b]) => b - a)
    .map(([start, list]) => ({ start, rows: list.sort((a, b) => b.eatenAt - a.eatenAt) }));
}

export function MealRow({ row }: { row: MealRowData }) {
  const m = row.meal;
  const hot = row.status === "needs_input";
  const failed = row.status === "failed" || row.refused;
  const loud = hot || failed;
  const kcal = m?.totals?.nutrients.energyKcal;

  let detail: string;
  if (row.refused) detail = "An upload was refused. Tap to fix.";
  else if (row.status === "failed")
    detail = `${firstLine(m?.analysisError) ?? "The analysis failed."} Tap to retry.`;
  else if (hot)
    detail = m?.openQuestions ? `${plural(m.openQuestions, "question")} for you` : "Needs your input";
  else {
    const parts = [
      m?.sourceMealId ? "Logged again" : m?.sourcePlannedMealId ? "From the plan" : "",
      m ? captureSummary(m.captureKinds) : "",
    ];
    if (row.pending > 0) parts.push(`${row.pending} uploading`);
    if (m && m.pendingTranscripts > 0) parts.push("transcribing");
    detail = parts.filter(Boolean).join(" · ");
  }

  return (
    <li
      className={cn(
        hot && !failed && "bg-lime text-lime-foreground",
        failed && "bg-orange text-orange-foreground",
      )}
    >
      <Link
        to="/meals/$mealId"
        params={{ mealId: row.id }}
        className={cn(
          "flex min-h-[84px] items-stretch gap-4 px-5 py-3 outline-none focus-visible:ring-4 focus-visible:ring-foreground/30 focus-visible:ring-inset",
          loud ? "active:opacity-80" : "active:bg-tint",
        )}
        data-testid="meal-row"
        data-meal-id={row.id}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold">{formatTime(row.eatenAt)}</span>
            <span className={loud ? "opacity-60" : "text-muted-foreground"}>·</span>
            <StatusLabel status={row.refused ? "failed" : row.status} />
          </div>
          <div className="display mt-1.5 text-[19px] leading-[1.05] tracking-[-0.02em]">
            {m?.title ?? "Untitled meal"}
          </div>
          <div
            className={cn(
              "mt-1.5 line-clamp-2",
              loud ? "font-bold text-sm" : "font-medium text-muted-foreground text-xs",
            )}
          >
            {detail}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between">
          {kcal !== undefined ? (
            <div className="text-right">
              <div className="display text-[26px]">{formatNumber(kcal)}</div>
              <Label className={cn("text-[10px]", hot ? "text-lime-muted" : "text-muted-foreground")}>
                {hot ? "prelim." : "kcal"}
              </Label>
            </div>
          ) : (
            // no analysis yet: the day's totals don't include it, and the row says so
            <div className="text-right" data-testid="not-counted">
              <div className={cn("display text-[26px]", !loud && "text-muted-foreground/40")}>—</div>
              <Label className={cn("text-[10px]", loud ? "opacity-70" : "text-muted-foreground")}>
                not counted
              </Label>
            </div>
          )}
          {loud && <ArrowRight className="size-5" strokeWidth={2.5} />}
        </div>
      </Link>
    </li>
  );
}

const firstLine = (s: string | null | undefined) => s?.split("\n")[0]?.trim() || null;
