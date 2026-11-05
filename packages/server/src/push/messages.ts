import {
  type Meal,
  type MealRevisionView,
  PUSH_EVENTS,
  type PushEvent,
  type PushPayload,
} from "@yamt/shared";
import type { Services } from "../services.ts";
import type { DeliveryResult } from "./sender.ts";

const MAX_TITLE = 80;
const MAX_BODY = 160;

const clip = (s: string, max: number) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const number = (n: number) => Math.round(n).toLocaleString("en");
const grams = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} g`;

/** Whether a meal status is one the analysis notifies of (not `queued`: another analysis waits). */
export const isPushEvent = (status: string): status is PushEvent =>
  (PUSH_EVENTS as readonly string[]).includes(status);

/** A tap opens the meal; with a question, scrolled to it. */
export const mealUrl = (mealId: string, event: PushEvent) =>
  `/meals/${mealId}${event === "needs_input" ? "#questions" : ""}`;

/**
 * The notification for a meal whose analysis ended (`analysed`, `needs_input`, `failed`), or
 * null for any other status. Numbers come from the revision view, i.e. from `computeTotals`.
 *
 * - analysed: "<title> · <kcal> kcal", the macros below
 * - needs_input: "<title> · needs input", the first question
 * - failed: "<title> · failed" (or "Meal at HH:MM"), the error's first part
 */
export function mealNotification(
  meal: Meal,
  view: MealRevisionView | null,
  timeZone: string,
): { event: PushEvent; payload: PushPayload } | null {
  const event = meal.status;
  if (!isPushEvent(event)) return null;
  const title =
    view?.revision.title.trim() ||
    `Meal at ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(meal.eatenAt)}`;
  const base = { url: mealUrl(meal.id, event), tag: `meal-${meal.id}`, event };

  if (event === "analysed") {
    if (!view) return null;
    const n = view.totals.nutrients;
    return {
      event,
      payload: {
        ...base,
        title: `${clip(title, MAX_TITLE - 16)} · ${number(n.energyKcal)} kcal`,
        body: `Protein ${grams(n.protein)} · Fat ${grams(n.fat)} · Carbs ${grams(n.carbohydrate)}`,
      },
    };
  }
  if (event === "needs_input") {
    const [first, ...more] = view?.questions ?? [];
    return {
      event,
      payload: {
        ...base,
        title: `${clip(title, MAX_TITLE - 14)} · needs input`,
        body: first
          ? clip(`${first.question}${more.length > 0 ? ` (+${more.length} more)` : ""}`, MAX_BODY)
          : "The analysis has a question for you.",
      },
    };
  }
  return {
    event,
    payload: {
      ...base,
      title: `${clip(title, MAX_TITLE - 9)} · failed`,
      body: shortError(meal.analysisError),
    },
  };
}

/** The error's first clause, short enough for a lock screen. */
function shortError(error: string | null): string {
  const first = (error ?? "").split(/;\s|\n/)[0]?.trim();
  return first
    ? `${clip(`${first[0]!.toUpperCase()}${first.slice(1)}`, MAX_BODY - 16)}. Tap to retry.`
    : "Tap to retry.";
}

/** What "Send test notification" sends. */
export const TEST_NOTIFICATION: PushPayload = {
  title: "yamt",
  body: "Notifications work. This is how yamt tells you a meal is analysed.",
  url: "/settings",
  tag: "test",
  event: "test",
};

/**
 * Called when a meal's analyse job ended for now (`AnalysisJob.settled`): sends the meal's
 * notification to every subscription that wants it, if the meal ended in a notified status.
 * A meal left `queued` (another analysis of it is waiting) sends nothing: only the final state
 * of the latest run is notified, and a removed meal nothing at all. The message is built before
 * the first await, so it shows the meal as it was when the job settled.
 */
export async function notifyMeal(s: Services, mealId: string): Promise<DeliveryResult[]> {
  const meal = s.repos.meals.get(mealId);
  if (!meal || meal.removedAt !== null || !isPushEvent(meal.status)) return [];
  const view = meal.currentRevisionId ? s.revisions.view(meal.currentRevisionId) : null;
  const message = mealNotification(meal, view, s.timeZone);
  if (!message) return [];
  // a newer message about the meal replaces one the phone hasn't received yet
  return s.push.broadcast(message.event, message.payload, {
    topic: mealId.replaceAll("-", ""),
    urgency: "high",
  });
}
