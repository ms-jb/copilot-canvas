import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Connection } from "../../useConnection";
import { applyAppBadge, listenForNotificationTaps } from "./appBadge";
import { countUnread, dividerFor, markerAfter, sameMarker, type UnreadDivider } from "./model";
import { useReadMarker } from "./readMarker";

/** How long the "N new" line stays once the chat is on screen: long enough to be seen, not to nag. */
export const DIVIDER_SEEN_MS = 6000;
/** A reply that lands this soon after the chat came into view was waiting for it (a resumed app reconnecting). */
const REOPEN_GRACE_MS = 4000;

export interface Unread {
  /** Assistant replies that arrived while the chat was not on screen. */
  chat: number;
  /** Where the transcript shows "N new" for the replies that were unread when the chat opened. */
  divider: UnreadDivider | null;
  /** The reader has seen the divider (scrolled, sent, or looked at it long enough). */
  dismissDivider: () => void;
}

const QUIET: Unread = { chat: 0, divider: null, dismissDivider: () => {} };

const UnreadContext = createContext<Unread>(QUIET);

/** Provided once by the app; outside it nothing is unread. */
export const UnreadProvider = UnreadContext.Provider;
export const useUnread = (): Unread => useContext(UnreadContext);

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};

/** Whether the page is in front (not a hidden tab or a backgrounded app). No polling. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/**
 * Tracks the replies this device hasn't read and keeps the app icon in step. Replies after a read
 * marker kept in localStorage count as unread; the marker moves to the newest entry while the chat
 * is on screen in a visible page, so a reload or a replayed transcript counts nothing again. The
 * first transcript a device ever sees is read. Call once, in the app, where it is known whether
 * the chat is on screen.
 */
export function useUnreadTracking(connection: Connection, chatShown: boolean): Unread {
  const { entries, generation } = connection.view;
  const [marker, setMarker] = useReadMarker();
  const visible = useDocumentVisible();
  const ready = generation !== null;
  const watching = ready && chatShown && visible;

  const chatUnread = useMemo(() => countUnread(entries, marker), [entries, marker]);
  const latest = useRef(chatUnread);
  latest.current = chatUnread;

  // A device's first transcript is history, not news.
  useEffect(() => {
    if (ready && marker === null) setMarker(markerAfter(entries, null));
  }, [ready, marker, entries, setMarker]);

  // The divider is cut from what was unread at the moment the chat came into view, before the
  // marker moves; replies that arrive while it is already in view get no divider.
  const [divider, setDivider] = useState<UnreadDivider | null>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    if (!watching) {
      openedAt.current = 0;
      return setDivider((current) => (current === null ? current : null));
    }
    openedAt.current = Date.now();
    setDivider((current) => current ?? dividerFor(latest.current));
  }, [watching]);
  useEffect(() => {
    if (!divider) return;
    const timer = setTimeout(() => setDivider(null), DIVIDER_SEEN_MS);
    return () => clearTimeout(timer);
  }, [divider]);
  const dismissDivider = useCallback(() => setDivider((current) => (current ? null : current)), []);

  // Viewing the chat reads it.
  useEffect(() => {
    if (!watching || marker === null) return;
    if (chatUnread.count > 0 && Date.now() - openedAt.current < REOPEN_GRACE_MS) {
      setDivider((current) => current ?? dividerFor(chatUnread));
    }
    const next = markerAfter(entries, marker);
    if (!sameMarker(next, marker)) setMarker(next);
  }, [watching, entries, marker, chatUnread, setMarker]);

  // Replies landing while the chat is in view are read in the same breath: they never count.
  const chat = ready && !watching ? chatUnread.count : 0;

  // Wait for the first connection before touching the icon, or each start would clear it for a moment.
  useEffect(() => {
    if (ready) applyAppBadge(chat);
  }, [ready, chat]);
  useEffect(listenForNotificationTaps, []);

  return { chat, divider, dismissDivider };
}
