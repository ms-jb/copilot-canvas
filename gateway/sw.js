// Service worker for the phone app, served by the gateway at /sw.js.
//
// App shell: the page (network first, the cached copy only when offline), its hashed chunks (cache
// first: their names change with their content) and the other static files (stale while
// revalidate). Installing precaches the page and everything it links. API calls, the event stream
// and anything but a same-origin GET go to the network untouched, so a conversation is never
// cached.
//
// Pushes arrive empty: ask the gateway for a one-line status, briefly, and fall back to a generic
// notice so one is always shown (Safari drops subscriptions that push without showing one).
// Notices from `npm run notify` may carry a url to open on tap and their own tag.
//
// App icon badge: the page keeps the badge in step with what is unread and tells this worker the
// count. A push while no window is in front adds one to it, so the badge goes up while the app is
// closed; the page sets the real count when it opens. The Badging API is missing in some browsers,
// where this does nothing.

// Bump to drop every cached file at the next activation.
const VERSION = "v1";
const SHELL_CACHE = `cc-shell-${VERSION}`;
const ASSET_CACHE = `cc-assets-${VERSION}`;
const BADGE_CACHE = `cc-badge-${VERSION}`;
const CACHES = [SHELL_CACHE, ASSET_CACHE, BADGE_CACHE];
const BADGE_KEY = "/__badge";
// Hashed chunks of the last few builds; the oldest go first.
const MAX_ASSETS = 80;
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|mjs|css|woff2?)$/;
const STATIC = /^\/assets\/[A-Za-z0-9._~@/-]+$/;

/** A complete, same-origin answer that is safe to keep (not a login redirect or an error). */
const keepable = (response) =>
  response.ok && response.status === 200 && response.type === "basic" && !response.redirected;

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)),
  );
}

/** Stores `url` from the network unless it is cached already (hashed files never change). */
async function fetchInto(cacheName, url) {
  const cache = await caches.open(cacheName);
  if (cacheName === ASSET_CACHE && (await cache.match(url, { ignoreVary: true }))) return;
  const response = await fetch(url, { cache: "no-cache", redirect: "error" });
  if (keepable(response)) await cache.put(url, response);
}

/** Caches the files a page links (scripts, preloads, styles, icons, the manifest). */
async function precacheLinked(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:src|href)="\.?(\/assets\/[^"?#]+)"/g)) paths.add(match[1]);
  await Promise.all(
    [...paths]
      .filter((path) => STATIC.test(path))
      .map((path) =>
        fetchInto(HASHED.test(path) ? ASSET_CACHE : SHELL_CACHE, path).catch(() => {}),
      ),
  );
  await trim(await caches.open(ASSET_CACHE));
}

async function precache() {
  const response = await fetch("/", { cache: "no-cache", redirect: "error" });
  if (!keepable(response)) return;
  await (await caches.open(SHELL_CACHE)).put("/", response.clone());
  await precacheLinked(await response.text());
}

/** The page: the network's answer (even "Not connected"), or the cached shell when offline. */
async function page(event) {
  try {
    const response = await fetch(event.request);
    if (keepable(response)) {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(SHELL_CACHE)
          .then(async (cache) => {
            await cache.put("/", copy.clone());
            await precacheLinked(await copy.text());
          })
          .catch(() => {}),
      );
    }
    return response;
  } catch (error) {
    const cached = await caches.match("/", { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw error;
  }
}

async function hashed(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (keepable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request, { ignoreVary: true });
  const fresh = fetch(event.request).then(async (response) => {
    if (keepable(response)) await cache.put(event.request, response.clone());
    return response;
  });
  if (!cached) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || request.headers.has("range")) return;
  if (request.mode === "navigate" && url.pathname === "/") event.respondWith(page(event));
  else if (HASHED.test(url.pathname)) event.respondWith(hashed(request));
  else if (STATIC.test(url.pathname)) event.respondWith(staleWhileRevalidate(event));
});

const FALLBACK = { title: "Copilot", body: "Something needs your attention." };

/** An http(s) URL to open on tap, resolved against this origin, or null. */
function safeUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, self.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

async function latestNotice() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/push/latest", {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return FALLBACK;
    const notice = await response.json();
    if (typeof notice?.title !== "string" || typeof notice?.body !== "string") return FALLBACK;
    return {
      title: notice.title,
      body: notice.body,
      url: safeUrl(notice.url),
      tag: typeof notice.tag === "string" && /^[\w-]{1,64}$/.test(notice.tag) ? notice.tag : null,
    };
  } catch {
    return FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}

/** The unread count the page last reported, plus the pushes since. */
async function storedBadge() {
  try {
    const hit = await (await caches.open(BADGE_CACHE)).match(BADGE_KEY);
    const { count } = hit ? await hit.json() : {};
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

async function storeBadge(count) {
  try {
    const cache = await caches.open(BADGE_CACHE);
    await cache.put(BADGE_KEY, new Response(JSON.stringify({ count })));
  } catch {
    // The badge is a courtesy: a full or blocked cache never stops a notice.
  }
}

async function paintBadge(count) {
  try {
    const nav = self.navigator;
    if (count > 0 && nav?.setAppBadge) await nav.setAppBadge(count);
    else if (nav?.clearAppBadge) await nav.clearAppBadge();
  } catch {
    // Not supported here, or not allowed.
  }
}

const windows = () =>
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);

/** Counts a push the reader hasn't seen: none while a window of the app is in front. */
async function bumpBadge() {
  if ((await windows()).some((client) => client.visibilityState === "visible")) return;
  const count = (await storedBadge()) + 1;
  await storeBadge(count);
  await paintBadge(count);
}

self.addEventListener("install", (event) => {
  // A failed precache never blocks the worker: the page still works from the network.
  event.waitUntil(
    precache()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("cc-") && !CACHES.includes(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    Promise.all([
      latestNotice().then(({ title, body, url, tag }) =>
        self.registration.showNotification(title, {
          body,
          tag: tag ?? "copilot-companion",
          renotify: true,
          icon: "/assets/icon-192.png",
          data: { url: url ?? null },
        }),
      ),
      bumpBadge(),
    ]),
  );
});

// The page reports the app's unread total whenever it changes.
self.addEventListener("message", (event) => {
  const { type, count } = event.data ?? {};
  if (type === "badge" && Number.isInteger(count) && count >= 0) event.waitUntil(storeBadge(count));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  event.waitUntil(
    windows().then((clients) => {
      const open = clients[0];
      if (!open) return self.clients.openWindow(url ?? "/");
      // An open app is told where to go rather than opened a second time.
      if (url) open.postMessage({ type: "open", url });
      return open.focus();
    }),
  );
});
