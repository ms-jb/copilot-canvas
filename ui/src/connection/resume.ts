// A page that comes back (tab shown, screen woken, restored from the back/forward cache, network
// returned) can't trust its event stream: the OS may have killed the socket while it was away, and
// EventSource only learns of it later. Reconnecting right away replaces the dead stream with a fresh
// one, whose first snapshot also proves whether the host restarted.

/** A hidden spell this short leaves an open stream alone. */
export const RESUME_REOPEN_AFTER_MS = 5_000;
// visibilitychange, pageshow and focus usually fire together on one wake.
const COALESCE_MS = 1_000;

export interface Resume {
  /** How long the page was hidden, 0 if it wasn't (a focus or network event). */
  hiddenMs: number;
  /** The page came out of the back/forward cache. */
  restored: boolean;
}

type Target = Pick<EventTarget, "addEventListener" | "removeEventListener">;

interface ResumeDeps {
  doc: Target & { visibilityState: string };
  win: Target;
  now?: () => number;
  onResume: (resume: Resume) => void;
}

export function watchResume({ doc, win, now = Date.now, onResume }: ResumeDeps) {
  let hiddenAt: number | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  const hide = () => {
    hiddenAt ??= now();
  };
  const show = (restored: boolean) => {
    if (doc.visibilityState === "hidden") return hide();
    const at = now();
    const hiddenMs = hiddenAt === null ? 0 : at - hiddenAt;
    hiddenAt = null;
    if (!restored && hiddenMs === 0 && at - lastAt < COALESCE_MS) return;
    lastAt = at;
    onResume({ hiddenMs, restored });
  };
  const onVisibility = () => (doc.visibilityState === "hidden" ? hide() : show(false));
  const onPageShow = (event: Event) => show((event as PageTransitionEvent).persisted === true);
  const onFocusOrOnline = () => show(false);
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", hide);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("focus", onFocusOrOnline);
  win.addEventListener("online", onFocusOrOnline);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", hide);
    win.removeEventListener("pageshow", onPageShow);
    win.removeEventListener("focus", onFocusOrOnline);
    win.removeEventListener("online", onFocusOrOnline);
  };
}

export type ResumePlan = "none" | "bootstrap" | "reopen";

/**
 * What a resume should do. A stale page (the provider restarted) never recovers by itself: it asks
 * for a reload, so a resume leaves it alone. Before the first bootstrap succeeded, any resume (the
 * network returning, the page shown) tries again at once instead of waiting out the retry backoff;
 * otherwise an away page, or one whose stream is not open, opens a fresh stream.
 */
export function planResume(
  resume: Resume,
  state: { stale: boolean; hasGeneration: boolean; streamOpen: boolean },
): ResumePlan {
  if (state.stale) return "none";
  if (!state.hasGeneration) return "bootstrap";
  const away = resume.restored || resume.hiddenMs >= RESUME_REOPEN_AFTER_MS;
  return away || !state.streamOpen ? "reopen" : "none";
}
