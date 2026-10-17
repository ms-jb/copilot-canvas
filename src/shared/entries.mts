// Pure helpers for keeping an ordered, de-duplicated list of transcript entries.
// Used by the host (authoritative store) and by the renderer (client view state).

import { LIMITS } from "./contract.mts";
import type {
  PendingPrompt,
  ServerEvent,
  SessionControls,
  SessionStatus,
  TranscriptEntry,
  QueueState,
} from "./contract.mts";

export interface ViewState {
  generation: string | null;
  seq: number;
  entries: TranscriptEntry[];
  status: SessionStatus;
  controls: SessionControls;
  /** Pending requests the user can answer from the canvas, oldest first. */
  prompts: PendingPrompt[];
  queue?: QueueState;
}

export interface PendingRef {
  requestId: string;
  messageId?: string;
}

export const NO_CONTROLS: SessionControls = Object.freeze({
  available: { mode: false, model: false, reasoningEffort: false, contextTier: false },
  models: [],
}) as SessionControls;

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
  return {
    generation: null,
    seq: -1,
    entries: [],
    status: { phase: "idle" },
    controls: NO_CONTROLS,
    prompts: [],
  };
}

type EventData<E extends ServerEvent["name"]> = Extract<ServerEvent, { name: E }>["data"];

/**
 * Applies one parsed SSE event to the client view state and returns a new state.
 * `snapshot` replaces everything (this is also how reconnects resync); other events with a
 * sequence number at or below the last applied one are ignored.
 */
export function applyServerEvent<E extends ServerEvent["name"]>(
  state: ViewState,
  name: E,
  data: EventData<E>,
): ViewState {
  if (name === "snapshot") {
    const event = data as EventData<"snapshot">;
    return {
      generation: event.generation,
      seq: event.seq,
      entries: event.snapshot.entries.slice(-LIMITS.maxEntries),
      status: event.snapshot.status,
      controls: event.controls,
      prompts: event.snapshot.prompts ?? [],
      ...(event.snapshot.queue ? { queue: event.snapshot.queue } : {}),
    };
  }
  if (data.seq <= state.seq) {
    return state;
  }
  switch (name) {
    case "entry": {
      const event = data as EventData<"entry">;
      return { ...state, seq: event.seq, entries: upsertEntry(state.entries, event.entry) };
    }
    case "status": {
      const event = data as EventData<"status">;
      return { ...state, seq: event.seq, status: event.status };
    }
    case "controls": {
      const event = data as EventData<"controls">;
      return { ...state, seq: event.seq, controls: event.controls };
    }
    case "prompts": {
      const event = data as EventData<"prompts">;
      return { ...state, seq: event.seq, prompts: event.prompts };
    }
    case "queue": {
      const event = data as EventData<"queue">;
      return { ...state, seq: event.seq, queue: event.queue };
    }
    default:
      return state;
  }
}

/**
 * Drops pending composer drafts that the transcript already confirms, so an optimistic bubble
 * and its confirmed copy are never shown together.
 */
export function resolvePending<T extends PendingRef>(
  pending: T[],
  entries: TranscriptEntry[],
  removedRequestIds: readonly string[] = [],
): T[] {
  return pending.filter(
    (item) =>
      !removedRequestIds.includes(item.requestId) &&
      !entries.some(
        (entry) =>
          entry.kind === "user" &&
          (entry.requestId === item.requestId ||
            (item.messageId !== undefined && entry.id === `user:${item.messageId}`)),
      ),
  );
}
