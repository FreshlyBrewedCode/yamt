import { useMemo, useSyncExternalStore } from "react";
import { keys, queryClient } from "../queries";
import { Outbox, type OutboxSnapshot } from "./outbox";
import { openStore } from "./store";
import { httpTransport } from "./transport";
import type { MealEntry, OutboxStore, PlanningEntry } from "./types";

export { CaptureRejected, checkCapture, type OutboxSnapshot } from "./outbox";
export type {
  AnalyseEntry,
  CaptureEntry,
  MealEntry,
  OutboxEntry,
  PendingCapture,
  PendingPlanningInput,
  PlanInputEntry,
  PlanningEntry,
  PlanRequestEntry,
  PlanRoundEntry,
} from "./types";

const opened = openStore();
const store: OutboxStore = {
  all: async () => (await opened).all(),
  put: async (e) => (await opened).put(e),
  delete: async (id) => (await opened).delete(id),
};

/** The app's one upload queue (see outbox.ts). */
export const outbox = new Outbox({
  store,
  transport: httpTransport,
  isOnline: () => navigator.onLine,
  onSent: async (e) => {
    if (e.type === "capture" || e.type === "analyse") {
      void queryClient.invalidateQueries({ queryKey: keys.meals });
      await queryClient.invalidateQueries({ queryKey: keys.meal(e.mealId) });
    } else {
      // the thread first, so a sent input never blinks out of it
      await queryClient.invalidateQueries({ queryKey: keys.planningRequest(e.requestId) });
      void queryClient.invalidateQueries({ queryKey: keys.planningRequests });
    }
  },
});

/** Loads what an earlier visit left and sends it; wakes the queue when the network or the app comes back. */
export function startOutbox(): void {
  void outbox.start();
  addEventListener("online", () => outbox.wake());
  addEventListener("offline", () => outbox.wake());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") outbox.wake();
  });
}

export function useOutbox(): OutboxSnapshot {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
}

/** The queue's entries for one meal, oldest first. */
export function useMealOutbox(mealId: string): { snapshot: OutboxSnapshot; entries: MealEntry[] } {
  const snapshot = useOutbox();
  const entries = useMemo(
    () =>
      snapshot.entries.filter(
        (e): e is MealEntry => (e.type === "capture" || e.type === "analyse") && e.mealId === mealId,
      ),
    [snapshot, mealId],
  );
  return { snapshot, entries };
}

/** The queue's planning entries (#47), oldest first: every request's, or one request's. */
export function usePlanningOutbox(requestId?: string): {
  snapshot: OutboxSnapshot;
  entries: PlanningEntry[];
} {
  const snapshot = useOutbox();
  const entries = useMemo(
    () =>
      snapshot.entries.filter(
        (e): e is PlanningEntry =>
          (e.type === "plan-request" || e.type === "plan-input" || e.type === "plan-round") &&
          (requestId === undefined || e.requestId === requestId),
      ),
    [snapshot, requestId],
  );
  return { snapshot, entries };
}
