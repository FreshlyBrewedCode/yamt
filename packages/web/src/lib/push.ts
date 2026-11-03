// The browser's side of Web Push (#13): can this device receive pushes, is it subscribed, and
// subscribing / unsubscribing with the server's VAPID key. The server side (registration,
// toggles) goes through the hooks in queries.ts.
import type { SubscribeBody } from "@yamt/shared";
import { serviceWorkerReady } from "./sw";

/**
 * - `supported`: service worker, PushManager and Notification are there
 * - `not-installed`: iOS Safari in a tab: push needs the app added to the Home Screen
 * - `unsupported`: anything else without push (an old iOS, a browser without it)
 */
export type PushSupport = "supported" | "not-installed" | "unsupported";

export interface PushDevice {
  support: PushSupport;
  /** Null where notifications aren't supported. */
  permission: NotificationPermission | null;
  /** This browser's push subscription, if it has one. */
  endpoint: string | null;
}

/** iOS Safari defines `navigator.standalone`: false in a tab, true in the home-screen app. */
const standalone = (): boolean | undefined => (navigator as Navigator & { standalone?: boolean }).standalone;

export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  return standalone() === false ? "not-installed" : "unsupported";
}

/** The active worker's registration; null if there is none within 10 s (it failed to install). */
const activeRegistration = (): Promise<ServiceWorkerRegistration | null> =>
  Promise.race([serviceWorkerReady, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]);

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await activeRegistration();
  if (!reg) throw new Error("The service worker isn't running, so notifications can't work here.");
  return reg;
}

/** Where this device stands: support, permission, its current subscription. */
export async function pushDevice(): Promise<PushDevice> {
  const support = pushSupport();
  if (support !== "supported") return { support, permission: null, endpoint: null };
  const reg = await activeRegistration();
  if (!reg) return { support: "unsupported", permission: null, endpoint: null };
  const sub = await reg.pushManager.getSubscription();
  return { support, permission: Notification.permission, endpoint: sub?.endpoint ?? null };
}

/**
 * Asks for permission. Call it straight from the tap (iOS only asks from a user gesture), before
 * anything else is awaited.
 */
export function requestPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

const fromBase64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/**
 * A fresh subscription for the server's key: an earlier one is dropped first (the server didn't
 * know it any more, or it was made for another key), then the body to register it with.
 */
export async function subscribeDevice(publicKey: string): Promise<SubscribeBody> {
  const reg = await registration();
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64url(publicKey),
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser made a subscription without keys.");
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

/** Drops this browser's subscription, if any. */
export async function unsubscribeDevice(): Promise<void> {
  const reg = await activeRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}
