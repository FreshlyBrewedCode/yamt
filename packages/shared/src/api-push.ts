import { z } from "zod";

/**
 * Web Push (#13): the phone subscribes with the server's VAPID public key and registers the
 * subscription here; the analysis job notifies it when a meal is analysed, needs input or failed,
 * the plan job (#45) when a planning round is done or failed. Each subscription (one per device
 * and browser) has its own event toggles.
 */

export const pushPaths = {
  /** GET: the VAPID public key and every registered subscription (`PushResponse`). */
  push: "/api/push",
  /** POST: register (or refresh) a subscription, keyed by its endpoint (`SubscribeBody`). */
  subscriptions: "/api/push/subscriptions",
  /** PATCH its event toggles (`PushEventsBody`), DELETE it. */
  subscription: (id: string) => `/api/push/subscriptions/${id}`,
  /** POST: send a test notification to this one subscription, whatever its toggles. */
  test: (id: string) => `/api/push/subscriptions/${id}/test`,
} as const;

/**
 * What a notification is about: a meal's analysis ended in one of these statuses, or a planning
 * round ended (`planning`: done or failed, #45).
 */
export const PUSH_EVENTS = ["analysed", "needs_input", "failed", "planning"] as const;
export const PushEvent = z.enum(PUSH_EVENTS);
export type PushEvent = z.infer<typeof PushEvent>;

/** Which events a subscription is notified of. */
export type PushEvents = Record<PushEvent, boolean>;

/** The toggles; one left out (`planning` from an app that predates it) stays as it was. */
export const PushEventsBody = z
  .object({
    analysed: z.boolean(),
    needs_input: z.boolean(),
    failed: z.boolean(),
    planning: z.boolean().optional(),
  })
  .strict();
export type PushEventsBody = z.infer<typeof PushEventsBody>;

export const ALL_PUSH_EVENTS: PushEvents = {
  analysed: true,
  needs_input: true,
  failed: true,
  planning: true,
};

const base64url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "not base64url")
    .refine((s) => Math.floor((s.replace(/=+$/, "").length * 3) / 4) === bytes, `expected ${bytes} bytes`);

/**
 * `POST /api/push/subscriptions`: a `PushSubscription.toJSON()` as the browser makes it, plus
 * optional toggles. The same endpoint again updates the keys and keeps the toggles unless given
 * (the app re-registers its subscription on every start, so the server never misses a new one).
 */
export const SubscribeBody = z
  .object({
    endpoint: z.url({ protocol: /^https$/, error: "the endpoint must be an https URL" }).max(2_048),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: base64url(65), auth: base64url(16) }),
    events: PushEventsBody.optional(),
  })
  .strip();
export type SubscribeBody = z.infer<typeof SubscribeBody>;

export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  events: PushEvents;
  createdAt: number;
  updatedAt: number;
  /** When the push service last accepted a message for it. */
  lastSentAt: number | null;
  /** Why the last delivery failed (an HTTP status or a network error); null after a success. */
  lastError: string | null;
}

export interface PushResponse {
  /** The VAPID public key (base64url, uncompressed P-256): `applicationServerKey`. */
  publicKey: string;
  subscriptions: PushSubscriptionView[];
}

export interface PushSubscriptionResponse {
  subscription: PushSubscriptionView;
}

/**
 * How a delivery went: `sent` (the push service took it), `gone` (404/410: the subscription
 * expired or was revoked; it is removed), `failed` (anything else; kept, with `error`).
 */
export type PushDelivery = "sent" | "gone" | "failed";

export interface PushTestResponse {
  delivery: PushDelivery;
  error: string | null;
}

/** What the service worker receives (inside the encrypted payload; nothing in the clear). */
export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap leads, a path of the app (`/meals/<id>`, `/plan/requests/<id>`). */
  url: string;
  /** One notification per meal (or planning request): a newer one replaces it. */
  tag: string;
  event: PushEvent | "test";
}
