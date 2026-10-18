// Pure helpers for keeping an ordered, de-duplicated list of transcript entries.
// Used by the host (authoritative store) and by the renderer (client view state).
import { LIMITS, pruneActivity } from "./contract.mjs";
export const NO_CONTROLS = Object.freeze({
    available: { mode: false, model: false, reasoningEffort: false, contextTier: false },
    models: [],
});
/** Inserts or replaces an entry by id. New entries are placed by timestamp (stable for ties). */
export function upsertEntry(entries, entry, maxEntries = LIMITS.maxEntries) {
    const index = entries.findIndex((existing) => existing.id === entry.id);
    const next = entries.slice();
    if (index >= 0) {
        next[index] = entry;
    }
    else {
        let position = next.length;
        while (position > 0 && next[position - 1].timestamp > entry.timestamp) {
            position -= 1;
        }
        next.splice(position, 0, entry);
    }
    return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}
export function createViewState() {
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
function latestUserTimestamp(entries) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].kind === "user")
            return entries[index].timestamp;
    }
    return undefined;
}
/**
 * Applies one parsed SSE event to the client view state and returns a new state.
 * `snapshot` replaces everything (this is also how reconnects resync); other events with a
 * sequence number at or below the last applied one are ignored.
 */
export function applyServerEvent(state, name, data) {
    const settleStreaming = (entries, phase) => phase === "working"
        ? entries
        : entries.map((entry) => entry.kind === "assistant" && entry.streaming === true
            ? { ...entry, streaming: false }
            : entry);
    if (name === "snapshot") {
        const event = data;
        return {
            generation: event.generation,
            seq: event.seq,
            entries: settleStreaming(event.snapshot.entries.slice(-LIMITS.maxEntries), event.snapshot.status.phase),
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
            const event = data;
            const entries = upsertEntry(state.entries, event.entry);
            const activity = event.entry.kind === "user"
                ? pruneActivity(state.activity, latestUserTimestamp(entries))
                : state.activity;
            return { ...state, seq: event.seq, entries, activity };
        }
        case "status": {
            const event = data;
            return {
                ...state,
                seq: event.seq,
                status: event.status,
                entries: settleStreaming(state.entries, event.status.phase),
            };
        }
        case "controls": {
            const event = data;
            return { ...state, seq: event.seq, controls: event.controls };
        }
        case "prompts": {
            const event = data;
            return { ...state, seq: event.seq, prompts: event.prompts };
        }
        case "queue": {
            const event = data;
            return { ...state, seq: event.seq, queue: event.queue };
        }
        case "context": {
            const event = data;
            return { ...state, seq: event.seq, context: event.context };
        }
        case "activity": {
            const event = data;
            const activity = pruneActivity(upsertEntry(state.activity, event.item, Number.POSITIVE_INFINITY), latestUserTimestamp(state.entries));
            return { ...state, seq: event.seq, activity };
        }
        case "append": {
            const { seq, target, id, text } = data;
            // The host only appends to a text item this connection has; anything else is ignored.
            const grow = (list) => {
                const index = list.findIndex((item) => item.id === id);
                const item = list[index];
                if (!item || !("text" in item) || typeof item.text !== "string")
                    return list;
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
export function resolvePending(pending, entries, removedRequestIds = []) {
    return pending.filter((item) => !removedRequestIds.includes(item.requestId) &&
        !entries.some((entry) => entry.kind === "user" &&
            (entry.requestId === item.requestId ||
                (item.messageId !== undefined && entry.id === `user:${item.messageId}`))));
}
