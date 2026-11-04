// All server state goes through TanStack Query: one key per resource here, one hook per query.

import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  apiPaths,
  type CreateGoalBody,
  type DayResponse,
  type FixGoalBody,
  type GoalResponse,
  type GoalsResponse,
  goalPaths,
  type HealthResponse,
  type MealDetailResponse,
  type MealResponse,
  type MealRevisionsResponse,
  type MealStatus,
  type MealsResponse,
  mealPaths,
  type RetractResponse,
  runPaths,
  type TranscribeResponse,
  type UpdateMealBody,
  type WeightEntryResponse,
  type WeightResponse,
  weightPaths,
} from "@yamt/shared";
import { ApiError, api } from "./api";
import { type ParsedTrace, parseTrace } from "./trace";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export const keys = {
  health: ["health"] as const,
  meals: ["meals"] as const,
  mealsRange: (from: number, to: number, tz: string) => ["meals", { from, to, tz }] as const,
  meal: (id: string) => ["meal", id] as const,
  revisions: (mealId: string) => ["meal", mealId, "revisions"] as const,
  trace: (runId: string) => ["run", runId, "trace"] as const,
  /** Under "meals", so everything that refreshes the meals refreshes the day view too. */
  day: (date: string, tz: string) => ["meals", "day", date, tz] as const,
  goals: ["goals"] as const,
  weight: ["weight"] as const,
  weightRange: (from: number, to: number) => ["weight", { from, to }] as const,
};

/** The browser's zone: days are the phone's calendar days. */
export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

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
  const tz = browserZone();
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

/**
 * Every revision of a meal with its totals, newest first. Only fetched when `enabled` (the
 * history is opened); refreshed with the meal (its key sits under the meal's).
 */
export function useRevisions(mealId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.revisions(mealId),
    queryFn: () => api.get<MealRevisionsResponse>(mealPaths.revisions(mealId)),
    enabled,
  });
}

/**
 * A run's trace, parsed (`lib/trace.ts`). Fetched only when opened; a running run's trace grows,
 * so it is polled until the run has ended.
 */
export function useTrace(runId: string, enabled: boolean, running: boolean) {
  return useQuery<ParsedTrace>({
    queryKey: keys.trace(runId),
    queryFn: async () => {
      const res = await fetch(runPaths.trace(runId), { credentials: "same-origin" });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, err?.error ?? `${res.status} ${res.statusText}`);
      }
      return parseTrace(await res.text());
    },
    enabled,
    staleTime: running ? 0 : Number.POSITIVE_INFINITY,
    refetchInterval: running ? POLL_MS : false,
  });
}

/** When the meal was eaten: a time pins it, `null` lets the captures decide again. */
export function useUpdateMeal(mealId: string) {
  return useMutation({
    mutationFn: (body: UpdateMealBody) => api.patch<MealResponse>(mealPaths.meal(mealId), body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.meal(mealId) });
      void queryClient.invalidateQueries({ queryKey: keys.meals });
    },
  });
}

/** Transcribe a voice capture again (after a failure). */
export function useRetranscribe(mealId: string) {
  return useMutation({
    mutationFn: (captureId: string) => api.post<TranscribeResponse>(mealPaths.transcribe(captureId)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.meal(mealId) }),
  });
}

/**
 * A calendar day (`YYYY-MM-DD`, the phone's zone): its meals, totals, the goal in force with the
 * progress against it, and its weight. Polls while one of its meals is in motion.
 */
export function useDay(date: string) {
  const tz = browserZone();
  return useQuery({
    queryKey: keys.day(date, tz),
    queryFn: () => api.get<DayResponse>(`${goalPaths.day(date)}?tz=${encodeURIComponent(tz)}`),
    placeholderData: (prev) => (prev?.date === date ? prev : undefined),
    refetchInterval: (q) =>
      q.state.data?.meals.some((m) => busy(m.status) || m.pendingTranscripts > 0) ? POLL_MS : false,
  });
}

/** Every goal, newest first (a short list); `goalInForce` picks a day's. */
export function useGoals() {
  return useQuery({
    queryKey: keys.goals,
    queryFn: () => api.get<GoalsResponse>(goalPaths.goals),
    staleTime: 60_000,
  });
}

/** New targets from today (a new goal), or `fix` the latest one in place (a typo). */
export function useSaveGoal() {
  return useMutation({
    mutationFn: (v: { body: CreateGoalBody } | { fix: string; body: FixGoalBody }) =>
      "fix" in v
        ? api.patch<GoalResponse>(goalPaths.goal(v.fix), v.body)
        : api.post<GoalResponse>(goalPaths.goals, v.body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.goals });
      void queryClient.invalidateQueries({ queryKey: keys.meals });
    },
  });
}

/** Weight entries measured in [from, to), newest first. */
export function useWeight(from: number, to: number) {
  return useQuery({
    queryKey: keys.weightRange(from, to),
    queryFn: () => api.get<WeightResponse>(`${weightPaths.weight}?from=${from}&to=${to}&limit=1000`),
  });
}

const weightChanged = () => {
  void queryClient.invalidateQueries({ queryKey: keys.weight });
  void queryClient.invalidateQueries({ queryKey: keys.meals });
};

export function useLogWeight() {
  return useMutation({
    mutationFn: (body: { kg: number; measuredAt?: number; note?: string }) =>
      api.post<WeightEntryResponse>(weightPaths.weight, body),
    onSettled: weightChanged,
  });
}

export function useDeleteWeight() {
  return useMutation({
    mutationFn: (id: string) => api.delete(weightPaths.entry(id)),
    onSettled: weightChanged,
  });
}
