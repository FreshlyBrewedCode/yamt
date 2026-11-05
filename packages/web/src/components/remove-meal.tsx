// Removing a meal (soft): a "Remove meal" row at the end of a meal's screen with an inline
// confirm, the day's "Meal removed · Undo" strip, and the screen of a removed meal opened
// directly (an old link), which offers Restore. One request each, not through the upload queue.
import { useNavigate } from "@tanstack/react-router";
import type { Meal, MealDetailResponse } from "@yamt/shared";
import { cn } from "cn";
import { RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDayTime, localDate, plural } from "@/lib/format";
import { outbox, useMealOutbox } from "@/lib/outbox";
import { removeError, useMeal, useRemoveMeal, useRestoreMeal } from "@/lib/queries";
import { ItemsList } from "./items-list";
import { BackButton, Band, BottomSlab, Label, SlabButton, Strip } from "./slab";
import { TotalsSlab } from "./totals-slab";

/** How long the day keeps the undo strip, and the row its "Remove?" confirm. */
const UNDO_MS = 12_000;
const CONFIRM_MS = 4_000;

/**
 * The last row of a meal's screen: "Remove meal", which asks once inline ("Remove meal?" and a
 * Remove button, like a capture's ✕) and then removes the meal and opens its day, which offers
 * Undo. Captures still on this phone hold it (they would be refused once the meal is gone);
 * a queued analysis request of the meal is dropped with it.
 */
export function RemoveMealRow({ meal }: { meal: Meal }) {
  const navigate = useNavigate();
  const remove = useRemoveMeal();
  const { entries } = useMealOutbox(meal.id);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  const uploads = entries.filter((e) => e.type === "capture").length;
  const busy = meal.status === "queued" || meal.status === "analysing";

  const confirm = () =>
    remove.mutate(meal.id, {
      onSuccess: async ({ meal: removed }) => {
        // an analyse request waiting in the queue would only be refused now
        for (const e of entries) if (e.type === "analyse") await outbox.discard(e.id);
        void navigate({
          to: "/days/$date",
          params: { date: localDate(removed.eatenAt) },
          search: { removed: removed.id },
          replace: true,
        });
      },
      onSettled: () => setConfirming(false),
    });

  return (
    <section className="border-border border-b" data-testid="remove-meal">
      {uploads > 0 ? (
        <div className="flex min-h-14 items-center justify-between gap-3 px-5 text-muted-foreground">
          <div className="min-w-0 py-2">
            <div className="font-bold uppercase tracking-[0.08em]">Remove meal</div>
            <p className="mt-0.5 font-medium text-sm">
              {plural(uploads, "upload")} still on this phone: wait for{" "}
              {uploads === 1 ? "it, or discard it" : "them, or discard them"} first.
            </p>
          </div>
          <Trash2 className="size-5 shrink-0" strokeWidth={2.5} />
        </div>
      ) : confirming || remove.isPending ? (
        <div className="flex min-h-14 items-center justify-between gap-3 px-5">
          <div className="min-w-0 py-2">
            <div className="font-bold uppercase tracking-[0.08em]">Remove meal?</div>
            <p className="mt-0.5 font-medium text-muted-foreground text-sm">
              {busy ? "Its analysis stops. " : ""}It leaves its day and the totals; you can undo it.
            </p>
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={remove.isPending}
            className="-mr-2 h-11 shrink-0 bg-foreground px-3 font-bold text-background text-xs uppercase tracking-[0.08em] disabled:opacity-60"
            data-testid="remove-meal-confirm"
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left font-bold uppercase tracking-[0.08em] outline-none focus-visible:bg-tint"
        >
          Remove meal
          <Trash2 className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        </button>
      )}
      {remove.isError && (
        <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
          {removeError(remove.error, "remove")}
        </p>
      )}
    </section>
  );
}

/**
 * The day's strip after a meal was removed from it (`?removed=<id>`): "Meal removed", its title,
 * and Undo, which brings the meal back into the list. It goes after `UNDO_MS`, on Undo, and with
 * any navigation (the search parameter doesn't follow). Quiet tint: nothing failed, and nothing
 * wants the user.
 */
export function RemovedStrip({ mealId, onDone }: { mealId: string; onDone: () => void }) {
  const query = useMeal(mealId);
  const restore = useRestoreMeal();
  const detail = query.data;
  const removed = detail?.meal.removedAt != null;
  useEffect(() => {
    if (restore.isPending || restore.isError) return;
    const t = setTimeout(onDone, UNDO_MS);
    return () => clearTimeout(t);
  }, [onDone, restore.isPending, restore.isError]);
  // an old link after an undo elsewhere: nothing to say
  if (!detail || !removed) return null;
  const title = detail.revision?.revision.title ?? "Untitled meal";

  return (
    <Band tone="tint" role="status" data-testid="removed-strip">
      <div className="flex min-h-16 items-center gap-3 px-5 py-2">
        <div className="min-w-0 flex-1">
          <Label className="text-muted-foreground">Meal removed</Label>
          <p className="truncate font-bold">{title}</p>
        </div>
        <button
          type="button"
          onClick={() => restore.mutate(mealId, { onSuccess: onDone })}
          disabled={restore.isPending}
          className="-mr-2 flex h-11 shrink-0 items-center gap-2 bg-foreground px-4 font-bold text-background text-xs uppercase tracking-[0.08em] disabled:opacity-60"
        >
          <RotateCcw className="size-4" strokeWidth={2.5} />
          {restore.isPending ? "Undoing…" : "Undo"}
        </button>
      </div>
      {restore.isError && (
        <p className="bg-orange px-5 py-3 font-bold text-orange-foreground text-sm" role="alert">
          {removeError(restore.error, "restore")}
        </p>
      )}
    </Band>
  );
}

/**
 * A removed meal opened directly (an old link, a notification): what it was, said to be removed
 * and not counted, with **Restore** as the (tint) bottom slab. Nothing on it can be changed.
 */
export function RemovedMeal({ detail }: { detail: MealDetailResponse }) {
  const { meal, revision: view } = detail;
  const restore = useRestoreMeal();
  const live = detail.captures.filter((c) => c.retractedAt === null).length;
  return (
    <>
      <header className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <BackButton />
          <Label className="flex h-8 items-center bg-tint px-2.5" data-testid="removed-chip">
            Removed
          </Label>
        </div>
        <Label className="mt-4 text-muted-foreground">{formatDayTime(meal.eatenAt)}</Label>
        <h1
          className="display mt-1 text-[32px] text-muted-foreground leading-[0.95]"
          data-testid="meal-title"
        >
          {view?.revision.title ?? "Untitled meal"}
        </h1>
        {view?.revision.summary && (
          <p className="mt-2 font-medium text-muted-foreground">{view.revision.summary}</p>
        )}
      </header>

      <main className="flex-1">
        <Band tone="tint" className="px-5 pt-4 pb-5" data-testid="removed-meal">
          <Label className="text-muted-foreground">
            Removed {meal.removedAt !== null ? formatDayTime(meal.removedAt) : ""}
          </Label>
          <p className="mt-2 font-medium">
            It isn't counted in its day or anywhere else, and the agent doesn't see it. Nothing of it was
            deleted: restore it to have it back as it was
            {live > 0 ? `, with its ${plural(live, "capture")}` : ""}.
          </p>
        </Band>
        {view && (
          <>
            <TotalsSlab
              totals={view.totals}
              label="kcal · not counted"
              note={
                <>
                  <Square className="size-2.5 fill-current" strokeWidth={0} />
                  Removed: in no day's totals
                </>
              }
              data-testid="meal-totals"
            />
            <Strip title="Items" meta="g · kcal" />
            <ItemsList items={view.items} />
          </>
        )}
        {restore.isError && (
          <Band tone="orange" className="px-5 py-3" role="alert">
            <p className="font-bold text-sm">{removeError(restore.error, "restore")}</p>
          </Band>
        )}
      </main>

      <BottomSlab>
        <SlabButton
          tone="tint"
          onClick={() => restore.mutate(meal.id)}
          disabled={restore.isPending}
          className={cn(restore.isPending && "animate-pulse")}
          data-testid="restore-meal"
        >
          <RotateCcw className="size-7" strokeWidth={2.5} />{" "}
          {restore.isPending ? "Restoring…" : "Restore meal"}
        </SlabButton>
      </BottomSlab>
    </>
  );
}
