// yamt's service worker: app-shell caching, so the home-screen app opens without a network, and
// Web Push (#13): it shows the notifications the server sends and opens the meal on a tap.
// It never touches /api (meals, captures, media) or /mcp: server state always comes from the
// network, and uploads that can't reach it wait in the app's own queue (IndexedDB, src/lib/outbox).
//
// This file is a template: the `serviceWorker` plugin in vite.config.ts fills in the build's
// version and file list and emits it as /sw.js; in dev (Vite) it serves it with no file list,
// which turns the shell cache off and leaves push working. The app registers it in src/lib/sw.ts.

const VERSION = "__YAMT_SW_VERSION__";
/** Every file of the build (hashed assets, icons, manifest), relative to the root; null in dev. */
const PRECACHE = __YAMT_SW_PRECACHE__;
/** Dev (Vite) serves fresh files itself: no shell cache, only push. */
const CACHE_SHELL = PRECACHE !== null;
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
      if (CACHE_SHELL) {
        const cache = await caches.open(SHELL);
        await cache.addAll(["/", ...PRECACHE.map((f) => `/${f}`)]);
      }
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
  if (!CACHE_SHELL || req.method !== "GET") return;
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

// ---- Web Push (#13) ------------------------------------------------------------------------------
// The payload (encrypted by the server, decrypted by the browser) is the server's `PushPayload`:
// {title, body, url, tag, event}. Every push shows a notification: iOS revokes the subscription
// of a worker that receives pushes without showing one.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || "yamt", {
        body: data.body || "",
        // one notification per meal: a newer one replaces it, and still alerts
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: typeof data.url === "string" ? data.url : "/" },
      });
      // an open app refreshes what it shows (the meal's new status) without waiting for its poll
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.postMessage({ type: "yamt:refresh" });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(openApp(url.pathname + url.search + url.hash));
});

/** Focuses an open app window and lets its router go to `path`; opens a new one otherwise. */
async function openApp(path) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const win = windows.find((w) => new URL(w.url).origin === self.location.origin);
  if (win) {
    try {
      await win.focus();
    } catch {
      // not allowed to focus: the message still moves it to the meal
    }
    win.postMessage({ type: "yamt:navigate", url: path });
    return;
  }
  await self.clients.openWindow(path);
}
