// Service worker for the phone app, served by the gateway at /sw.js. It caches nothing.
// Pushes arrive empty: ask the gateway for a one-line status, briefly, and fall back to a generic
// notice so one is always shown (Safari drops subscriptions that push without showing one).

const FALLBACK = { title: "Copilot", body: "Something needs your attention." };

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
    return typeof notice?.title === "string" && typeof notice?.body === "string"
      ? notice
      : FALLBACK;
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
    latestNotice().then(({ title, body }) =>
      self.registration.showNotification(title, {
        body,
        tag: "copilot-canvas",
        renotify: true,
        icon: "/assets/icon-192.png",
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => (clients[0] ? clients[0].focus() : self.clients.openWindow("/"))),
  );
});
