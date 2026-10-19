import { isRemote } from "../../remote";

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Puts `total` on the installed app's icon (nothing at zero) and tells the worker, which adds the
 * pushes that arrive while the app is closed. Browsers without the Badging API, and pages outside
 * the phone app, do nothing.
 */
export function applyAppBadge(total: number): void {
  if (!isRemote()) return;
  const nav: BadgeNavigator = navigator;
  try {
    void Promise.resolve(total > 0 ? nav.setAppBadge?.(total) : nav.clearAppBadge?.()).catch(
      () => {},
    );
    nav.serviceWorker?.controller?.postMessage({ type: "badge", count: total });
  } catch {
    // Not supported or not allowed: the badge is a courtesy.
  }
}

/** The hash a worker's "open" message names when it points into this page, else null. */
export function hashFromWorker(
  data: unknown,
  page: Pick<URL, "href" | "origin" | "pathname">,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, url } = data as Record<string, unknown>;
  if (type !== "open" || typeof url !== "string") return null;
  try {
    const target = new URL(url, page.href);
    return target.origin === page.origin && target.pathname === page.pathname
      ? target.hash || "#/"
      : null;
  } catch {
    return null;
  }
}

/** Lets a tapped notice steer the page that is already open (the worker doesn't open a second). */
export function listenForNotificationTaps(): () => void {
  const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!worker) return () => {};
  const onMessage = (event: MessageEvent) => {
    const hash = hashFromWorker(event.data, window.location);
    if (hash !== null) window.location.hash = hash;
  };
  worker.addEventListener("message", onMessage);
  return () => worker.removeEventListener("message", onMessage);
}
