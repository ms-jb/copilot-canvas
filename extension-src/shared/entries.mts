// Pure helpers for keeping an ordered, de-duplicated list of transcript entries.
// Used by the host (authoritative store) and by the renderer (client view state).

import { LIMITS } from "./contract.mts";
import type { ServerEvent, SessionStatus, TranscriptEntry } from "./contract.mts";

export interface ViewState {
  generation: string | null;
  seq: number;
  entries: TranscriptEntry[];
  status: SessionStatus;
}

export interface PendingRef {
  requestId: string;
  messageId?: string;
}

/** Inserts or replaces an entry by id. New entries are placed by timestamp (stable for ties). */
export function upsertEntry(
  entries: TranscriptEntry[],
  entry: TranscriptEntry,
  maxEntries: number = LIMITS.maxEntries,
): TranscriptEntry[] {
  const index = entries.findIndex((existing) => existing.id === entry.id);
  const next = entries.slice();
  if (index >= 0) {
    next[index] = entry;
  } else {
    let position = next.length;
    while (position > 0 && next[position - 1]!.timestamp > entry.timestamp) {
      position -= 1;
    }
    next.splice(position, 0, entry);
  }
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}

export function createViewState(): ViewState {
  return { generation: null, seq: -1, entries: [], status: { phase: "idle" } };
}

/**
 * Applies one parsed SSE event to the client view state and returns a new state.
 * `snapshot` replaces everything (this is also how reconnects resync); other events with a
 * sequence number at or below the last applied one are ignored.
 */
export function applyServerEvent<E extends ServerEvent["name"]>(
  state: ViewState,
  name: E,
  data: Extract<ServerEvent, { name: E }>["data"],
): ViewState {
  if (name === "snapshot") {
    const event = data as Extract<ServerEvent, { name: "snapshot" }>["data"];
    return {
      generation: event.generation,
      seq: event.seq,
      entries: event.snapshot.entries.slice(-LIMITS.maxEntries),
      status: event.snapshot.status,
    };
  }
  if (data.seq <= state.seq) {
    return state;
  }
  if (name === "entry") {
    const event = data as Extract<ServerEvent, { name: "entry" }>["data"];
    return { ...state, seq: event.seq, entries: upsertEntry(state.entries, event.entry) };
  }
  if (name === "status") {
    const event = data as Extract<ServerEvent, { name: "status" }>["data"];
    return { ...state, seq: event.seq, status: event.status };
  }
  return state;
}

/**
 * Drops pending composer drafts that the transcript already confirms, so an optimistic bubble
 * and its confirmed copy are never shown together.
 */
export function resolvePending<T extends PendingRef>(
  pending: T[],
  entries: TranscriptEntry[],
): T[] {
  return pending.filter(
    (item) =>
      !entries.some(
        (entry) =>
          entry.kind === "user" &&
          (entry.requestId === item.requestId ||
            (item.messageId !== undefined && entry.id === `user:${item.messageId}`)),
      ),
  );
}
