// Pure helpers for keeping an ordered, de-duplicated list of transcript entries.
// Used by the host (authoritative store) and by the renderer (client view state).
import { LIMITS } from "./contract.mjs";
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
    };
}
/**
 * Applies one parsed SSE event to the client view state and returns a new state.
 * `snapshot` replaces everything (this is also how reconnects resync); other events with a
 * sequence number at or below the last applied one are ignored.
 */
export function applyServerEvent(state, name, data) {
    if (name === "snapshot") {
        const event = data;
        return {
            generation: event.generation,
            seq: event.seq,
            entries: event.snapshot.entries.slice(-LIMITS.maxEntries),
            status: event.snapshot.status,
            controls: event.controls,
            prompts: event.snapshot.prompts ?? [],
        };
    }
    if (data.seq <= state.seq) {
        return state;
    }
    switch (name) {
        case "entry": {
            const event = data;
            return { ...state, seq: event.seq, entries: upsertEntry(state.entries, event.entry) };
        }
        case "status": {
            const event = data;
            return { ...state, seq: event.seq, status: event.status };
        }
        case "controls": {
            const event = data;
            return { ...state, seq: event.seq, controls: event.controls };
        }
        case "prompts": {
            const event = data;
            return { ...state, seq: event.seq, prompts: event.prompts };
        }
        default:
            return state;
    }
}
/**
 * Drops pending composer drafts that the transcript already confirms, so an optimistic bubble
 * and its confirmed copy are never shown together.
 */
export function resolvePending(pending, entries) {
    return pending.filter((item) => !entries.some((entry) => entry.kind === "user" &&
        (entry.requestId === item.requestId ||
            (item.messageId !== undefined && entry.id === `user:${item.messageId}`))));
}
