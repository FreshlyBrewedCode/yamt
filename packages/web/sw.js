// yamt's service worker: app-shell caching only, so the home-screen app opens without a network.
// It never touches /api (meals, captures, media) or /mcp: server state always comes from the
// network, and uploads that can't reach it wait in the app's own queue (IndexedDB, src/lib/outbox).
//
// This file is a template: the `serviceWorker` plugin in vite.config.ts fills in the build's
// version and file list and emits it as /sw.js. #13 (Web Push) adds its `push` and
// `notificationclick` handlers at the end of this file; the app registers it in src/lib/sw.ts.

const VERSION = "__YAMT_SW_VERSION__";
/** Every file of the build (hashed assets, icons, manifest), relative to the root. */
const PRECACHE = __YAMT_SW_PRECACHE__;
const SHELL = `yamt-shell-${VERSION}`;
/** How long a navigation waits for the network before the cached shell answers. */
const NAVIGATION_TIMEOUT_MS = 4000;

const isServerState = (url) =>
  url.pathname === "/api" ||
  url.pathname.startsWith("/api/") ||
  url.pathname === "/mcp" ||
  url.pathname.startsWith("/mcp/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(["/", ...PRECACHE.map((f) => `/${f}`)]);
      // take over at once: the previous build's chunks stay reachable through the network
      // until the page reloads (the app reloads itself if a lazy chunk is gone)
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("yamt-shell-") && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isServerState(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(navigation(req));
    return;
  }
  event.respondWith(shellFile(req));
});

/** Network first (a fresh index.html after a deploy), the cached shell when offline or slow. */
async function navigation(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), NAVIGATION_TIMEOUT_MS);
    if (res.ok) await cache.put("/", res.clone());
    return res;
  } catch {
    return (await cache.match("/")) ?? Response.error();
  }
}

/** Cache first: hashed assets never change; anything else is fetched and kept if it is ours. */
async function shellFile(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).pathname.startsWith("/assets/")) {
    const cache = await caches.open(SHELL);
    await cache.put(req, res.clone());
  }
  return res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
