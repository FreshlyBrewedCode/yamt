// All server state goes through TanStack Query: one key per resource here, one hook per query.

import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  apiPaths,
  type CreateGoalBody,
  type DayResponse,
  type FixGoalBody,
  type GoalResponse,
  type GoalsResponse,
  type GuidedGoalBody,
  goalPaths,
  type HealthResponse,
  type MealDetailResponse,
  type MealResponse,
  type MealRevisionsResponse,
  type MealStatus,
  type MealsResponse,
  mealPaths,
  type ProfileResponse,
  type PushEvents,
  type PushResponse,
  type PushSubscriptionResponse,
  type PushTestResponse,
  profilePaths,
  pushPaths,
  type RetractResponse,
  runPaths,
  type TranscribeResponse,
  type UpdateMealBody,
  type WeightEntryResponse,
  type WeightResponse,
  weightPaths,
} from "@yamt/shared";
import { ApiError, api } from "./api";
import { pushDevice, subscribeDevice, unsubscribeDevice } from "./push";
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
  weightRecent: ["weight", "recent"] as const,
  profile: ["profile"] as const,
  push: ["push"] as const,
  /** This browser's support, permission and subscription (not server state, kept here with it). */
  pushDevice: ["push", "device"] as const,
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

/** The newest weight entries (enough for the guided setup's "last 7 days"), newest first. */
export function useRecentWeight() {
  return useQuery({
    queryKey: keys.weightRecent,
    queryFn: () => api.get<WeightResponse>(`${weightPaths.weight}?limit=60`),
  });
}

/** The body profile the guided setup saved (#24); null before the first one. */
export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: () => api.get<ProfileResponse>(profilePaths.profile),
    staleTime: 60_000,
  });
}

/** A guided goal: the server calculates it again, saves the profile and the goal from today. */
export function useSaveGuidedGoal() {
  return useMutation({
    mutationFn: (body: GuidedGoalBody) => api.post<GoalResponse>(profilePaths.guidedGoal, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.goals });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.weight });
      void queryClient.invalidateQueries({ queryKey: keys.meals });
    },
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

// ---- Web Push (#13) -----------------------------------------------------------------------------

/** The server's VAPID key and every registered subscription. */
export function usePush() {
  return useQuery({ queryKey: keys.push, queryFn: () => api.get<PushResponse>(pushPaths.push) });
}

/** This device: push support, permission, subscription. Rechecked when the app comes back (iOS Settings). */
export function usePushDevice() {
  return useQuery({
    queryKey: keys.pushDevice,
    queryFn: pushDevice,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

const pushChanged = () => queryClient.invalidateQueries({ queryKey: keys.push });

/**
 * Turns notifications on for this device: `permission` is the promise of
 * `Notification.requestPermission()`, started in the tap itself (iOS asks only from a gesture).
 * Then a fresh subscription for the server's key, registered with the server.
 */
export function useTurnOnPush() {
  return useMutation({
    mutationFn: async (v: { permission: Promise<NotificationPermission>; publicKey: string }) => {
      if ((await v.permission) !== "granted") return null;
      const body = await subscribeDevice(v.publicKey);
      return (await api.post<PushSubscriptionResponse>(pushPaths.subscriptions, body)).subscription;
    },
    onSettled: pushChanged,
  });
}

/** Turns them off here: the server forgets the subscription, the browser drops it. */
export function useTurnOffPush() {
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(pushPaths.subscription(id)).catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      });
      await unsubscribeDevice();
    },
    onSettled: pushChanged,
  });
}

/** Which events this subscription hears about; shown at once, undone if the server refuses. */
export function useSetPushEvents() {
  return useMutation({
    mutationFn: (v: { id: string; events: PushEvents }) =>
      api.patch<PushSubscriptionResponse>(pushPaths.subscription(v.id), v.events),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: keys.push, exact: true });
      const before = queryClient.getQueryData<PushResponse>(keys.push);
      if (before) {
        queryClient.setQueryData<PushResponse>(keys.push, {
          ...before,
          subscriptions: before.subscriptions.map((s) => (s.id === v.id ? { ...s, events: v.events } : s)),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(keys.push, ctx.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.push, exact: true }),
  });
}

export function useTestPush() {
  return useMutation({
    mutationFn: (id: string) => api.post<PushTestResponse>(pushPaths.test(id)),
    // a gone subscription was removed on the server
    onSuccess: (r) => (r.delivery === "gone" ? pushChanged() : undefined),
  });
}
