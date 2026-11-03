/**
 * Registers the service worker (`/sw.js`, built from `packages/web/sw.js`): app-shell caching so
 * the home-screen app opens offline. Production builds only; dev (Vite) runs without one.
 *
 * #13 (Web Push) awaits `serviceWorkerReady` to subscribe with `registration.pushManager`.
 */
export const serviceWorkerReady: Promise<ServiceWorkerRegistration | null> =
  import.meta.env.PROD && "serviceWorker" in navigator
    ? navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e: unknown) => {
        console.warn("service worker not registered", e);
        return null;
      })
    : Promise.resolve(null);
