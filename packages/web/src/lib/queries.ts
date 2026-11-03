// All server state goes through TanStack Query: one key per resource here, one hook per query.

import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  apiPaths,
  type HealthResponse,
  type MealDetailResponse,
  type MealStatus,
  type MealsResponse,
  mealPaths,
  type RetractResponse,
} from "@yamt/shared";
import { ApiError, api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export const keys = {
  health: ["health"] as const,
  meals: ["meals"] as const,
  mealsRange: (from: number, to: number, tz: string) => ["meals", { from, to, tz }] as const,
  meal: (id: string) => ["meal", id] as const,
};

/** While something is in motion on the server, the screen polls (no push channel needed). */
const POLL_MS = 3000;
const busy = (s: MealStatus) => s === "queued" || s === "analysing";

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => api.get<HealthResponse>(apiPaths.health),
    refetchInterval: 30_000,
  });
}

/** The overview: meals eaten in [from, to) and each day's totals, days reckoned in the browser's zone. */
export function useMeals(from: number, to: number) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery({
    queryKey: keys.mealsRange(from, to, tz),
    queryFn: () =>
      api.get<MealsResponse>(
        `${mealPaths.meals}?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}&limit=500`,
      ),
    refetchInterval: (q) =>
      q.state.data?.meals.some((m) => busy(m.status) || m.pendingTranscripts > 0) ? POLL_MS : false,
  });
}

/**
 * One meal with its captures, transcripts, revision and runs. A meal the server doesn't know
 * (yet) is `null`, not an error: a new meal exists only on this phone until its first capture is up.
 */
export function useMeal(id: string) {
  return useQuery({
    queryKey: keys.meal(id),
    queryFn: async () => {
      try {
        return await api.get<MealDetailResponse>(mealPaths.meal(id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return busy(d.meal.status) || d.transcripts.some((t) => t.status === "pending") ? POLL_MS : false;
    },
  });
}

/** Retract a capture (soft; it can't be undone). */
export function useRetract(mealId: string) {
  return useMutation({
    mutationFn: (captureId: string) => api.post<RetractResponse>(mealPaths.retract(captureId)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.meal(mealId) });
      void queryClient.invalidateQueries({ queryKey: keys.meals });
    },
  });
}
