// Service worker for the phone app, served by the gateway at /sw.js. It caches nothing.
// Pushes arrive empty: ask the gateway for a one-line status, briefly, and fall back to a generic
// notice so one is always shown (Safari drops subscriptions that push without showing one).
// Notices from `npm run notify` may carry a url to open on tap and their own tag.

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

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    latestNotice().then(({ title, body, url, tag }) =>
      self.registration.showNotification(title, {
        body,
        tag: tag ?? "copilot-canvas",
        renotify: true,
        icon: "/assets/icon-192.png",
        data: { url: url ?? null },
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  event.waitUntil(
    url
      ? self.clients.openWindow(url)
      : self.clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then((clients) => (clients[0] ? clients[0].focus() : self.clients.openWindow("/"))),
  );
});
