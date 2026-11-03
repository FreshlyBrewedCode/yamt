import { useMemo, useSyncExternalStore } from "react";
import { keys, queryClient } from "../queries";
import { Outbox, type OutboxSnapshot } from "./outbox";
import { openStore } from "./store";
import { httpTransport } from "./transport";
import type { OutboxEntry, OutboxStore } from "./types";

export { CaptureRejected } from "./outbox";
export type { AnalyseEntry, CaptureEntry, OutboxEntry, PendingCapture } from "./types";

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
    void queryClient.invalidateQueries({ queryKey: keys.meals });
    await queryClient.invalidateQueries({ queryKey: keys.meal(e.mealId) });
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
export function useMealOutbox(mealId: string): { snapshot: OutboxSnapshot; entries: OutboxEntry[] } {
  const snapshot = useOutbox();
  const entries = useMemo(() => snapshot.entries.filter((e) => e.mealId === mealId), [snapshot, mealId]);
  return { snapshot, entries };
}
