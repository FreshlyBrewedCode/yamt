import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { DayTotals, MealStatus, MealSummary } from "@yamt/shared";
import { cn } from "cn";
import { ArrowRight, CloudOff, Plus } from "lucide-react";
import { useMemo } from "react";
import { BottomSlab, Label, SlabButton, StatusLabel, Strip } from "@/components/slab";
import { TotalsSlab } from "@/components/totals-slab";
import {
  captureSummary,
  dayLabel,
  formatLongDate,
  formatNumber,
  formatTime,
  localDate,
  plural,
  startOfDay,
} from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { type OutboxEntry, useOutbox } from "@/lib/outbox";
import { useMeals } from "@/lib/queries";

export const Route = createFileRoute("/")({ component: Overview });

/** How far back the overview reaches (days including today). */
const DAYS = 14;

interface Row {
  id: string;
  eatenAt: number;
  status: MealStatus;
  meal: MealSummary | null;
  /** Captures still on this phone. */
  pending: number;
  /** An upload the server refused. */
  refused: boolean;
}

/** Home: today's totals, then the last two weeks' meals by day, and Log meal at the bottom. */
function Overview() {
  const navigate = useNavigate();
  const now = Date.now();
  const today = startOfDay(now);
  const from = startOfDay(now, -(DAYS - 1));
  const to = startOfDay(now, 1);
  const meals = useMeals(from, to);
  const outbox = useOutbox();

  const days = useMemo(() => {
    const list = groupByDay(meals.data?.meals ?? [], outbox.entries);
    // today always comes first, even before anything is logged
    return list[0]?.start === today ? list : [{ start: today, rows: [] as Row[] }, ...list];
  }, [meals.data, outbox.entries, today]);
  const totals = new Map<string, DayTotals>((meals.data?.days ?? []).map((d) => [d.date, d]));
  const todayTotals = totals.get(localDate(now));
  const todayRows = days.find((d) => d.start === today)?.rows ?? [];
  const waiting = todayRows.filter((r) => !r.meal?.totals).length;

  return (
    <>
      <header className="flex items-end justify-between px-5 pt-5 pb-4">
        <div>
          <Label className="text-muted-foreground">{formatLongDate(now)}</Label>
          <h1 className="display mt-1 text-[36px]">Today</h1>
        </div>
        {(!outbox.online || meals.isError) && (
          <Label className="flex h-12 items-center gap-2 bg-tint px-3 text-muted-foreground" role="status">
            <CloudOff className="size-4" strokeWidth={2.5} /> Offline
          </Label>
        )}
      </header>

      <main className="flex-1">
        {/* The one thing on this screen: today's totals. #12 adds the targets. */}
        <TotalsSlab
          totals={todayTotals?.totals ?? null}
          label="kcal today"
          data-testid="today-totals"
          aside={
            waiting > 0 ? (
              <>
                <div className="display text-[28px]">{waiting}</div>
                <Label className="mt-1 text-ink-muted">not analysed yet</Label>
              </>
            ) : undefined
          }
        />

        {meals.isError && !meals.data && (
          <p className="px-5 py-6 font-medium text-muted-foreground">
            Can't reach yamt right now. Meals you log are kept on this phone and sent when it's back.
          </p>
        )}

        {days.map((day) => (
          <section key={day.start} aria-label={dayLabel(day.start, now)}>
            <Strip
              title={dayLabel(day.start, now)}
              meta={
                day.start === today
                  ? plural(day.rows.length, "meal")
                  : `${formatNumber(totals.get(localDate(day.start))?.totals.nutrients.energyKcal ?? 0)} kcal`
              }
            />
            {day.rows.length === 0 ? (
              <p className="px-5 py-6 font-medium text-muted-foreground">
                {meals.isPending ? "Loading…" : "Nothing logged yet today."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {day.rows.map((r) => (
                  <MealRow key={r.id} row={r} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>

      {/* Log meal is part of the layout: a lime slab at the bottom, never floating over the list. */}
      <BottomSlab>
        <SlabButton
          onClick={() =>
            navigate({ to: "/meals/$mealId", params: { mealId: uuidv7() }, search: { new: true } })
          }
        >
          <Plus className="size-8" strokeWidth={3} /> Log meal
        </SlabButton>
      </BottomSlab>
    </>
  );
}

/**
 * Days, newest first, with their meals: the server's, plus meals that exist only on this phone so
 * far (started offline). Empty drafts (opened, nothing captured) are left out.
 */
function groupByDay(meals: MealSummary[], entries: readonly OutboxEntry[]) {
  const rows = new Map<string, Row>();
  for (const m of meals) {
    rows.set(m.id, { id: m.id, eatenAt: m.eatenAt, status: m.status, meal: m, pending: 0, refused: false });
  }
  for (const e of entries) {
    if (e.type !== "capture") continue;
    const row = rows.get(e.mealId) ?? {
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
  const byDay = new Map<number, Row[]>();
  for (const r of rows.values()) {
    if (r.meal && r.meal.captureCount === 0 && r.pending === 0) continue;
    const start = startOfDay(r.eatenAt);
    byDay.set(start, [...(byDay.get(start) ?? []), r]);
  }
  return [...byDay]
    .sort(([a], [b]) => b - a)
    .map(([start, list]) => ({ start, rows: list.sort((a, b) => b.eatenAt - a.eatenAt) }));
}

function MealRow({ row }: { row: Row }) {
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
    const parts = [m ? captureSummary(m.captureKinds) : ""];
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
            <div className={cn("display text-[26px]", !loud && "text-muted-foreground/40")}>—</div>
          )}
          {loud && <ArrowRight className="size-5" strokeWidth={2.5} />}
        </div>
      </Link>
    </li>
  );
}

const firstLine = (s: string | null | undefined) => s?.split("\n")[0]?.trim() || null;
