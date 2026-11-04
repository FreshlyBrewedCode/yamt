/**
 * Registers the service worker (`/sw.js`, built from `packages/web/sw.js`): app-shell caching so
 * the home-screen app opens offline (production builds), and Web Push (#13, dev too: Vite serves
 * a push-only worker).
 *
 * `serviceWorkerReady` is null where there is no service worker (or it failed to register).
 */
export const serviceWorkerReady: Promise<ServiceWorkerRegistration | null> =
  "serviceWorker" in navigator
    ? navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .catch((e: unknown) => {
          console.warn("service worker not registered", e);
          return null;
        })
    : Promise.resolve(null);

/** What the worker tells open windows: go to a meal (a tapped notification), or refresh (a push arrived). */
export type WorkerMessage = { type: "yamt:navigate"; url: string } | { type: "yamt:refresh" };

/** Listens to the worker's messages; returns the unsubscribe. */
export function onWorkerMessage(handler: (m: WorkerMessage) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const listener = (e: MessageEvent) => {
    const m = e.data as Partial<WorkerMessage> | null;
    if (m?.type === "yamt:refresh") handler({ type: "yamt:refresh" });
    // only paths of this app: never a URL somewhere else
    if (m?.type === "yamt:navigate" && typeof m.url === "string" && /^\/(?!\/)/.test(m.url)) {
      handler({ type: "yamt:navigate", url: m.url });
    }
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
