// All server state goes through TanStack Query: one key per resource here, one hook per query.

import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  type AddShoppingLineBody,
  type AgentOptionsResponse,
  type AgentResponse,
  type AgentSettingsBody,
  agentPaths,
  apiPaths,
  type CreateGoalBody,
  type CreateLeftoverBody,
  calendarPaths,
  type DayResponse,
  type FixGoalBody,
  type GoalResponse,
  type GoalsResponse,
  type GuidedGoalBody,
  goalPaths,
  type HealthResponse,
  type LeftoverResponse,
  type LeftoverStatus,
  type LeftoversResponse,
  type LogPlannedMealBody,
  type LogPlannedMealResponse,
  leftoverPaths,
  type MealDetailResponse,
  type MealResponse,
  type MealRevisionsResponse,
  type MealStatus,
  type MealsResponse,
  type MonthResponse,
  mealPaths,
  type NightlyResponse,
  type PickSuggestionBody,
  type PickSuggestionResponse,
  type PlanLeftoverBody,
  type PlannedMealResponse,
  type PlanningRequestDetail,
  type PlanningRequestResponse,
  type PlanningRequestsResponse,
  type PlanningSettingsBody,
  type PlanningSettingsResponse,
  type PlanResponse,
  type ProfileResponse,
  type PushEvents,
  type PushResponse,
  type PushSubscriptionResponse,
  type PushTestResponse,
  planningNightlyPaths,
  planningPaths,
  planningRequestPaths,
  planningSettingsPaths,
  profilePaths,
  pushPaths,
  type RecipeView,
  type RegenerateNightlyResponse,
  type RemoveMealResponse,
  type RepeatableResponse,
  type RepeatMealResponse,
  type RestoreMealResponse,
  type RetractResponse,
  runPaths,
  type ShoppingCheckBody,
  type ShoppingListResponse,
  type SuggestionResponse,
  shoppingPaths,
  type TranscribeResponse,
  type UpdateMealBody,
  type UpdatePlannedMealBody,
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
  /** Under "meals": a new or re-analysed meal changes what can be logged again. */
  repeatable: ["meals", "repeatable"] as const,
  trace: (runId: string) => ["run", runId, "trace"] as const,
  /** Under "meals", so everything that refreshes the meals refreshes the day view too. */
  day: (date: string, tz: string) => ["meals", "day", date, tz] as const,
  /** Under "meals" too (and goals and weight refresh "meals" as well): the calendar's month. */
  month: (month: string, tz: string) => ["meals", "month", month, tz] as const,
  /** Under "meals" (#40): logging from the plan, and every meal change, refresh the plan. */
  plan: (from: string, to: string, tz: string) => ["meals", "plan", from, to, tz] as const,
  /** Under "meals" too: its status changes when a meal logged from it is removed or restored. */
  plannedMeal: (id: string) => ["meals", "planned", id] as const,
  /** Recipes are insert-only: one never changes. */
  recipe: (id: string) => ["recipe", id] as const,
  goals: ["goals"] as const,
  weight: ["weight"] as const,
  weightRange: (from: number, to: number) => ["weight", { from, to }] as const,
  weightRecent: ["weight", "recent"] as const,
  profile: ["profile"] as const,
  push: ["push"] as const,
  /** This browser's support, permission and subscription (not server state, kept here with it). */
  pushDevice: ["push", "device"] as const,
  agent: ["agent"] as const,
  agentOptions: (harness: string, model: string | null) => ["agent", "options", harness, model] as const,
  planningSettings: ["planning", "settings"] as const,
  /**
   * Under "meals" (#47): a push, a pick or an unplan and every meal change refresh the open
   * requests and the threads (their fit reads the plan).
   */
  planningRequests: ["meals", "planning", "requests"] as const,
  planningRequest: (id: string) => ["meals", "planning", "request", id] as const,
  /** The nightly run (#48): today's nightly requests and the starters; under "meals" like the threads. */
  nightly: ["meals", "planning", "nightly"] as const,
  /** Under "meals" (#49): logging from the plan and removing a meal change the leftovers. */
  leftovers: ["meals", "leftovers"] as const,
  /** Under "meals" too: every plan change changes the list. "" for a default end of the range. */
  shopping: (from: string, to: string, tz: string) => ["meals", "shopping", from, to, tz] as const,
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

/** The meal's detail with the meal as the server answered a removal or a restore, until it refetches. */
const mealChanged = (r: { meal: MealResponse["meal"] }) => {
  queryClient.setQueryData<MealDetailResponse | null>(keys.meal(r.meal.id), (d) =>
    d ? { ...d, meal: r.meal } : d,
  );
};
const mealsChanged = (mealId: string) => {
  void queryClient.invalidateQueries({ queryKey: keys.meal(mealId) });
  void queryClient.invalidateQueries({ queryKey: keys.meals });
};

/**
 * Remove a meal (soft: out of every day and total, nothing deleted; a queued or running analysis
 * stops). One request, not a capture, so not through the upload queue; offline it fails and says
 * so (`removeError`).
 */
export function useRemoveMeal() {
  return useMutation({
    mutationFn: (mealId: string) => api.post<RemoveMealResponse>(mealPaths.remove(mealId)),
    onSuccess: mealChanged,
    onSettled: (_r, _e, mealId) => mealsChanged(mealId),
  });
}

/** Undo a removal: the meal is back as it was. */
export function useRestoreMeal() {
  return useMutation({
    mutationFn: (mealId: string) => api.post<RestoreMealResponse>(mealPaths.restore(mealId)),
    onSuccess: mealChanged,
    onSettled: (_r, _e, mealId) => mealsChanged(mealId),
  });
}

/** What a failed remove or restore says: offline is the usual reason, and it needs the server. */
export function removeError(e: Error, what: "remove" | "restore"): string {
  if (!(e instanceof ApiError) || !navigator.onLine) {
    return `No connection: ${what === "remove" ? "removing" : "restoring"} a meal needs yamt. Try again once you're online.`;
  }
  return `Couldn't ${what} it: ${e.message}`;
}

/** Recent analysed meals to log again (#30), one per title, the most often logged first. */
export function useRepeatable(enabled = true) {
  return useQuery({
    queryKey: keys.repeatable,
    queryFn: () => api.get<RepeatableResponse>(mealPaths.repeatable),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Log a meal again (#30): one request, not a capture, so it doesn't go through the upload queue;
 * offline it fails and says so (`repeatError`). `id` (a UUIDv7 made when the sheet opened) makes
 * a retry after a lost response answer the same copy.
 */
export function useRepeatMeal() {
  return useMutation({
    mutationFn: (v: { sourceId: string; id: string; factor: number; eatenAt: number }) =>
      api.post<RepeatMealResponse>(mealPaths.repeat(v.sourceId), {
        id: v.id,
        factor: v.factor,
        eatenAt: v.eatenAt,
        tz: browserZone(),
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.meals }),
  });
}

/** What a failed "log again" says: offline is the usual reason, and it needs the server. */
export function repeatError(e: Error): string {
  if (!(e instanceof ApiError) || !navigator.onLine) {
    return "No connection: logging a meal again needs yamt. Try again once you're online.";
  }
  return `Couldn't log it: ${e.message}`;
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

/**
 * A calendar month (`YYYY-MM`, the phone's zone, #33): every day against the goal in force that
 * day, the weeks' classifier inputs, the summary and the weight's 7-day average.
 */
export function useMonth(month: string) {
  const tz = browserZone();
  return useQuery({
    queryKey: keys.month(month, tz),
    queryFn: () => api.get<MonthResponse>(`${calendarPaths.month(month)}?tz=${encodeURIComponent(tz)}`),
  });
}

// ---- Planning (#36, #40) ---------------------------------------------------------------------------

/**
 * The plan from `from` to `to` (`YYYY-MM-DD`, inclusive, the phone's zone): per day its planned
 * meals, the meals eaten, the eaten and projected totals, the goal, open slots and whether the day
 * is mostly known.
 */
export function usePlan(from: string, to: string, enabled = true) {
  const tz = browserZone();
  return useQuery({
    queryKey: keys.plan(from, to, tz),
    queryFn: () =>
      api.get<PlanResponse>(`${planningPaths.plan}?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`),
    enabled: enabled && from !== "" && to !== "",
  });
}

/** One planned meal (any status); null when there is none (unplanned, or never was). */
export function usePlannedMeal(id: string | null) {
  return useQuery({
    queryKey: keys.plannedMeal(id ?? ""),
    queryFn: async () => {
      try {
        return (await api.get<PlannedMealResponse>(planningPaths.plannedMeal(id ?? ""))).plannedMeal;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: id !== null,
  });
}

/** A recipe with its items (whole and per portion) and totals; recipes never change. */
export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: keys.recipe(id ?? ""),
    queryFn: () => api.get<RecipeView>(planningPaths.recipe(id ?? "")),
    enabled: !!id,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The planned meal as the server answered, then everything under "meals" (the plan, the days). */
const plannedChanged = (r: PlannedMealResponse) => {
  queryClient.setQueryData(keys.plannedMeal(r.plannedMeal.id), r.plannedMeal);
  void queryClient.invalidateQueries({ queryKey: keys.meals });
};

/** Move, re-portion or note a planned meal (only while `planned`). */
export function useUpdatePlannedMeal() {
  return useMutation({
    mutationFn: (v: { id: string; body: UpdatePlannedMealBody }) =>
      api.patch<PlannedMealResponse>(planningPaths.plannedMeal(v.id), v.body),
    onSuccess: plannedChanged,
  });
}

/** Skip it (it won't be eaten: counts nothing, fills no slot), or undo that. */
export function useSkipPlannedMeal() {
  return useMutation({
    mutationFn: (v: { id: string; skip: boolean }) =>
      api.post<PlannedMealResponse>(v.skip ? planningPaths.skip(v.id) : planningPaths.unskip(v.id)),
    onSuccess: plannedChanged,
  });
}

/** Unplan: the planned meal is deleted (only while `planned`; the recipe stays). */
export function useUnplanMeal() {
  return useMutation({
    mutationFn: (id: string) => api.delete(planningPaths.plannedMeal(id)),
    onSuccess: (_r, id) => {
      queryClient.setQueryData(keys.plannedMeal(id), null);
      void queryClient.invalidateQueries({ queryKey: keys.meals });
    },
  });
}

/**
 * "Ate it": a new meal from the planned meal's recipe, without a model. One request, not a
 * capture, so not through the upload queue; offline it fails and says so (`planError`). `body.id`
 * (a UUIDv7 made when the sheet opened) makes a retry answer the same meal.
 */
export function useLogPlannedMeal() {
  return useMutation({
    mutationFn: (v: { plannedMealId: string; body: LogPlannedMealBody }) =>
      api.post<LogPlannedMealResponse>(planningPaths.log(v.plannedMealId), v.body),
    onSuccess: (r) => queryClient.setQueryData(keys.plannedMeal(r.plannedMeal.id), r.plannedMeal),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.meals }),
  });
}

/** What a failed planning request says: offline is the usual reason, and it needs the server. */
export function planError(e: Error, what: string): string {
  if (!(e instanceof ApiError) || !navigator.onLine) {
    return `No connection: ${what} needs yamt. Try again once you're online.`;
  }
  return `Couldn't do it: ${e.message}`;
}

// ---- Leftovers and the shopping list (#49) -----------------------------------------------------

/** The open leftovers, oldest first. */
export function useLeftovers() {
  return useQuery({
    queryKey: keys.leftovers,
    queryFn: () => api.get<LeftoversResponse>(leftoverPaths.leftovers),
  });
}

/** After a change to a leftover: the lists, the plan and the shopping list (all under "meals"). */
const leftoversChanged = () => void queryClient.invalidateQueries({ queryKey: keys.meals });

/** One of the user's own leftovers ("Koriander, 1 bunch"). Online only: `body.id` makes a retry the same one. */
export function useCreateLeftover() {
  return useMutation({
    mutationFn: (body: CreateLeftoverBody) => api.post<LeftoverResponse>(leftoverPaths.leftovers, body),
    onSuccess: leftoversChanged,
  });
}

/** Used, gone, or open again. */
export function useSetLeftoverStatus() {
  return useMutation({
    mutationFn: (v: { id: string; status: LeftoverStatus }) =>
      api.patch<LeftoverResponse>(leftoverPaths.leftover(v.id), { status: v.status }),
    onSuccess: leftoversChanged,
  });
}

/** "Plan it": a cooked leftover onto a slot, as a planned meal that cooks nothing. */
export function usePlanLeftover() {
  return useMutation({
    mutationFn: (v: { leftoverId: string; body: PlanLeftoverBody }) =>
      api.post<PlannedMealResponse>(leftoverPaths.plan(v.leftoverId), v.body),
    onSuccess: plannedChanged,
  });
}

const shoppingUrl = (path: string, q: Record<string, string | undefined>) => {
  const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
  return `${path}?${params}`;
};

/**
 * The shopping list for `from`–`to` (the phone's zone); without them the server's default, today
 * to the last planned day. Online only.
 */
export function useShopping(from?: string, to?: string) {
  const tz = browserZone();
  return useQuery({
    queryKey: keys.shopping(from ?? "", to ?? "", tz),
    queryFn: () => api.get<ShoppingListResponse>(shoppingUrl(shoppingPaths.list, { from, to, tz })),
  });
}

/** Every write answers the list for its range: shown at once, the other ranges refreshed. */
const shoppingChanged = (list: ShoppingListResponse) => {
  queryClient.setQueryData(keys.shopping(list.from, list.to, list.timeZone), list);
  void queryClient.invalidateQueries({ queryKey: ["meals", "shopping"] });
};

/** A line into the basket or out of it. */
export function useCheckShopping() {
  return useMutation({
    mutationFn: (body: ShoppingCheckBody) =>
      api.post<ShoppingListResponse>(shoppingUrl(shoppingPaths.check, { tz: browserZone() }), body),
    onSuccess: shoppingChanged,
  });
}

/** A line of the user's own. */
export function useAddShoppingLine() {
  return useMutation({
    mutationFn: (body: AddShoppingLineBody) =>
      api.post<ShoppingListResponse>(shoppingUrl(shoppingPaths.lines, { tz: browserZone() }), body),
    onSuccess: shoppingChanged,
  });
}

/** One of the user's own lines removed. */
export function useRemoveShoppingLine() {
  return useMutation({
    mutationFn: (id: string) => api.delete(shoppingPaths.line(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["meals", "shopping"] }),
  });
}

// ---- Planning requests (#47) -----------------------------------------------------------------

const roundOpen = (s: string | undefined) => s === "queued" || s === "running";

/** The open requests, newest first, each with its latest round counted; polls while one runs. */
export function usePlanningRequests() {
  return useQuery({
    queryKey: keys.planningRequests,
    queryFn: () => api.get<PlanningRequestsResponse>(planningRequestPaths.requests),
    refetchInterval: (q) =>
      q.state.data?.requests.some((r) => roundOpen(r.latestRound?.status)) ? POLL_MS : false,
  });
}

/**
 * A request's thread: inputs, rounds, suggestions with their fit. A request the server doesn't
 * know (yet) is `null`: one made offline exists only in the upload queue until it is sent. Polls
 * while a round is queued or running.
 */
export function usePlanningRequest(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.planningRequest(id),
    enabled: enabled && id !== "",
    queryFn: async () => {
      try {
        return await api.get<PlanningRequestDetail>(planningRequestPaths.request(id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    refetchInterval: (q) => (q.state.data?.rounds.some((r) => roundOpen(r.status)) ? POLL_MS : false),
  });
}

/** After a verdict or an archive: the thread and the lists, and the plan (a pick is a planned meal). */
const requestChanged = (requestId: string) => {
  void queryClient.invalidateQueries({ queryKey: keys.planningRequest(requestId) });
  void queryClient.invalidateQueries({ queryKey: keys.meals });
};

/**
 * Pick: the suggestion becomes a planned meal (on the proposed slot unless `body` says another, else
 * the request's next open one). One request, not queued (like "Ate it"); `body.id` (made when the
 * band rendered) makes a retry answer the same planned meal.
 */
export function usePickSuggestion(requestId: string) {
  return useMutation({
    mutationFn: (v: { suggestionId: string; body: PickSuggestionBody }) =>
      api.post<PickSuggestionResponse>(planningRequestPaths.pick(v.suggestionId), v.body),
    onSuccess: (r) => queryClient.setQueryData(keys.plannedMeal(r.plannedMeal.id), r.plannedMeal),
    onSettled: () => requestChanged(requestId),
  });
}

/** "No", or its undo. */
export function useRejectSuggestion(requestId: string) {
  return useMutation({
    mutationFn: (v: { suggestionId: string; reject: boolean }) =>
      api.post<SuggestionResponse>(
        v.reject
          ? planningRequestPaths.reject(v.suggestionId)
          : planningRequestPaths.unreject(v.suggestionId),
      ),
    onSettled: () => requestChanged(requestId),
  });
}

/** Out of the open lists (a running round stops), or back. */
export function useArchiveRequest() {
  return useMutation({
    mutationFn: (v: { id: string; archive: boolean }) =>
      api.post<PlanningRequestResponse>(
        v.archive ? planningRequestPaths.archive(v.id) : planningRequestPaths.unarchive(v.id),
      ),
    onSettled: (_r, _e, v) => requestChanged(v.id),
  });
}

// ---- The nightly run (#48) -------------------------------------------------------------------

/**
 * The nightly part of the entry screen: the settings, when it runs next, today's nightly requests
 * (newest first; two while a regenerated one runs) and the starters. Polls while a round runs.
 */
export function useNightly() {
  return useQuery({
    queryKey: keys.nightly,
    queryFn: () => api.get<NightlyResponse>(planningNightlyPaths.nightly),
    refetchInterval: (q) =>
      q.state.data?.requests.some((d) => d.rounds.some((r) => roundOpen(r.status))) ? POLL_MS : false,
  });
}

/**
 * Regenerate: a new nightly request now; today's suggestions stay until its round is done. One
 * request, not queued (it needs the server); `id` (made when the button rendered) makes a retry
 * answer the same request.
 */
export function useRegenerateNightly() {
  return useMutation({
    mutationFn: (id: string) => api.post<RegenerateNightlyResponse>(planningNightlyPaths.regenerate, { id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.nightly });
      void queryClient.invalidateQueries({ queryKey: keys.planningRequests });
    },
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

// ---- Agent settings (#28) -------------------------------------------------------------------------

/** The effective harness, model and effort with their sources, and the harnesses found on the server. */
export function useAgent() {
  return useQuery({ queryKey: keys.agent, queryFn: () => api.get<AgentResponse>(agentPaths.agent) });
}

const optionsUrl = (harness: string, model: string | null, refresh = false) => {
  const q = new URLSearchParams({ harness });
  if (model) q.set("model", model);
  if (refresh) q.set("refresh", "1");
  return `${agentPaths.options}?${q}`;
};

const fetchAgentOptions = (harness: string, model: string | null) =>
  queryClient.fetchQuery({
    queryKey: keys.agentOptions(harness, model),
    queryFn: () => api.get<AgentOptionsResponse>(optionsUrl(harness, model)),
    staleTime: 5 * 60_000,
  });

/**
 * What a harness offers with `model` selected: the server starts the harness to ask (a second or
 * two) and keeps the answer an hour, so this stays fresh for a while too and isn't retried.
 */
export function useAgentOptions(harness: string | undefined, model: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.agentOptions(harness ?? "", model),
    queryFn: () => api.get<AgentOptionsResponse>(optionsUrl(harness ?? "", model)),
    enabled: enabled && !!harness,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Asks the harness again (a login fixed, a new model): drops what the server and the app know. */
export function useRefreshAgentOptions() {
  return useMutation({
    mutationFn: async (v: { harness: string; model: string | null }) => {
      const fresh = await api.get<AgentOptionsResponse>(optionsUrl(v.harness, v.model, true));
      queryClient.removeQueries({ queryKey: ["agent", "options", v.harness] });
      queryClient.setQueryData(keys.agentOptions(v.harness, v.model), fresh);
      return fresh;
    },
    onError: (_e, v) => queryClient.invalidateQueries({ queryKey: keys.agentOptions(v.harness, v.model) }),
  });
}

async function putAgent(url: string, v: AgentSettingsBody & { keepEffortIfOffered?: boolean }) {
  const { keepEffortIfOffered, ...body } = v;
  if (keepEffortIfOffered && body.effort !== null && body.model !== null) {
    const opts = await fetchAgentOptions(body.harness, body.model);
    if (!opts.effort?.choices.some((c) => c.value === body.effort)) body.effort = null;
  }
  return api.put<AgentResponse>(url, body);
}

/** Saves the app's Agent setting. A model switch keeps the saved effort only if the new model offers it. */
export function useSaveAgent() {
  return useMutation({
    mutationFn: (v: AgentSettingsBody & { keepEffortIfOffered?: boolean }) => putAgent(agentPaths.agent, v),
    onSuccess: (r) => queryClient.setQueryData(keys.agent, r),
  });
}

/** Saves the planning agent line (#46), under its own key but checked and shown the same way. */
export function useSavePlanningAgent() {
  return useMutation({
    mutationFn: (v: AgentSettingsBody & { keepEffortIfOffered?: boolean }) =>
      putAgent(agentPaths.planningAgent, v),
    onSuccess: (r) => queryClient.setQueryData(keys.agent, r),
  });
}

// ---- Planning settings (#46) -----------------------------------------------------------------

/** Suggestions per round, the default recipe source mode and portions to cook, and the preferences. */
export function usePlanningSettings() {
  return useQuery({
    queryKey: keys.planningSettings,
    queryFn: () => api.get<PlanningSettingsResponse>(planningSettingsPaths.settings),
  });
}

/** A whole replace, like the agent settings. */
export function useSavePlanningSettings() {
  return useMutation({
    mutationFn: (settings: PlanningSettingsBody) =>
      api.put<PlanningSettingsResponse>(planningSettingsPaths.settings, settings),
    onSuccess: (r) => {
      queryClient.setQueryData(keys.planningSettings, r);
      // the nightly run's schedule follows them (#48)
      void queryClient.invalidateQueries({ queryKey: keys.nightly });
    },
  });
}
