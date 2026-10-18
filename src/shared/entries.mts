// Pure helpers for keeping an ordered, de-duplicated list of transcript entries.
// Used by the host (authoritative store) and by the renderer (client view state).

import { LIMITS, pruneActivity } from "./contract.mts";
import type {
  ActivityItem,
  ContextState,
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
  /** Context window usage and the actions the host supports; absent when it isn't tracked. */
  context?: ContextState;
  /** Thinking blocks and the current turn's tool calls, oldest first. */
  activity: ActivityItem[];
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
export function upsertEntry<T extends { id: string; timestamp: string } = TranscriptEntry>(
  entries: T[],
  entry: T,
  maxEntries: number = LIMITS.maxEntries,
): T[] {
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
    activity: [],
  };
}

/** Tool calls belong to the turn the latest user message started; earlier ones are dropped. */
function latestUserTimestamp(entries: readonly TranscriptEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.kind === "user") return entries[index]!.timestamp;
  }
  return undefined;
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
      activity: event.snapshot.activity ?? [],
      ...(event.snapshot.queue ? { queue: event.snapshot.queue } : {}),
      ...(event.snapshot.context ? { context: event.snapshot.context } : {}),
    };
  }
  if (data.seq <= state.seq) {
    return state;
  }
  switch (name) {
    case "entry": {
      const event = data as EventData<"entry">;
      const entries = upsertEntry(state.entries, event.entry);
      const activity =
        event.entry.kind === "user"
          ? pruneActivity(state.activity, latestUserTimestamp(entries))
          : state.activity;
      return { ...state, seq: event.seq, entries, activity };
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
    case "context": {
      const event = data as EventData<"context">;
      return { ...state, seq: event.seq, context: event.context };
    }
    case "activity": {
      const event = data as EventData<"activity">;
      const activity = pruneActivity(
        upsertEntry(state.activity, event.item, Number.POSITIVE_INFINITY),
        latestUserTimestamp(state.entries),
      );
      return { ...state, seq: event.seq, activity };
    }
    case "append": {
      const { seq, target, id, text } = data as EventData<"append">;
      // The host only appends to a text item this connection has; anything else is ignored.
      const grow = <T extends { id: string }>(list: T[]) => {
        const index = list.findIndex((item) => item.id === id);
        const item = list[index];
        if (!item || !("text" in item) || typeof item.text !== "string") return list;
        const next = list.slice();
        next[index] = { ...item, text: item.text + text };
        return next;
      };
      return target === "entry"
        ? { ...state, seq, entries: grow(state.entries) }
        : { ...state, seq, activity: grow(state.activity) };
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
