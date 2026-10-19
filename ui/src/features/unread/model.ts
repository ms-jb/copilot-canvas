// What is unread, as plain functions: the chat's replies since this device last read it, and the
// divider that says where they start. The app icon shows the same count.
import type { TranscriptEntry } from "../../shared";

/** The last transcript entry this device has read. `at` backs the id up when the id is gone. */
export interface ReadMarker {
  id: string;
  at: string;
}

/** Before any entry existed: every later entry is unread. */
export const EMPTY_MARKER: ReadMarker = { id: "", at: "1970-01-01T00:00:00.000Z" };

export interface ChatUnread {
  /** Assistant entries after the marker. */
  count: number;
  /** The first of them, where the divider goes. */
  firstId: string | null;
}

const NONE: ChatUnread = { count: 0, firstId: null };

const after = (timestamp: string, at: string) => Date.parse(timestamp) > Date.parse(at);

/**
 * The assistant replies after the marker. The marker's own entry is found by id, so a transcript
 * replayed on reconnect, or one that grew at the front, counts nothing twice. When that entry is
 * gone (a new session, a trimmed history) the marker's time decides instead, so old history
 * replayed under new ids is not new. No marker means this device hasn't started reading: nothing.
 */
export function countUnread(
  entries: readonly TranscriptEntry[],
  marker: ReadMarker | null,
): ChatUnread {
  if (!marker) return NONE;
  const index = marker.id ? entries.findIndex((entry) => entry.id === marker.id) : -1;
  const later =
    index >= 0
      ? entries.slice(index + 1)
      : entries.filter((entry) => after(entry.timestamp, marker.at));
  const replies = later.filter((entry) => entry.kind === "assistant");
  return { count: replies.length, firstId: replies[0]?.id ?? null };
}

/** The marker for having read everything in `entries`; an empty transcript keeps the current one. */
export function markerAfter(
  entries: readonly TranscriptEntry[],
  current: ReadMarker | null,
): ReadMarker {
  const last = entries.at(-1);
  return last ? { id: last.id, at: last.timestamp } : (current ?? EMPTY_MARKER);
}

export const sameMarker = (a: ReadMarker | null, b: ReadMarker | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.at === b.at);

export function parseMarker(raw: string): ReadMarker | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { id, at } = value as Record<string, unknown>;
    return typeof id === "string" && typeof at === "string" && !Number.isNaN(Date.parse(at))
      ? { id, at }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Where the "N new" line goes in the transcript. */
export interface UnreadDivider {
  entryId: string;
  count: number;
}

export function dividerFor(unread: ChatUnread): UnreadDivider | null {
  return unread.firstId ? { entryId: unread.firstId, count: unread.count } : null;
}

export const dividerLabel = ({ count }: UnreadDivider) => (count > 1 ? `${count} new` : "New");

/** Spoken for the count badges: "3 unread replies". */
export const unreadLabel = (count: number) =>
  `${count} unread ${count === 1 ? "reply" : "replies"}`;
