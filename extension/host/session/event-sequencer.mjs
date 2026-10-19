import { describeSessionError } from "../logging.mjs";
function streamingKey(change) {
    if (change.type === "entry")
        return `entry:${change.entry.id}`;
    if (change.type === "activity")
        return `activity:${change.item.id}`;
    return null;
}
const isStreaming = (change) => (change.type === "entry" && change.entry.streaming === true) ||
    (change.type === "activity" &&
        change.item.kind === "reasoning" &&
        change.item.streaming === true);
/** One sequence for transcript, controls and prompts; streaming text alone is coalesced. */
export function createEventSequencer({ log, coalesceMs }) {
    const listeners = new Set();
    const pendingStreaming = new Map();
    let seq = 0;
    let flushTimer = null;
    let disposed = false;
    function emitNow(change) {
        seq += 1;
        const event = change.type === "entry"
            ? { seq, type: "entry", entry: { ...change.entry } }
            : change.type === "status"
                ? { seq, type: "status", status: { ...change.status } }
                : change.type === "activity"
                    ? { seq, type: "activity", item: { ...change.item } }
                    : { seq, ...change };
        for (const listener of Array.from(listeners)) {
            try {
                listener(event);
            }
            catch (error) {
                log(`Bridge listener failed: ${describeSessionError(error)}`, "warning");
            }
        }
    }
    function flushStreaming() {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        const batch = [...pendingStreaming.values()];
        pendingStreaming.clear();
        for (const change of batch)
            emitNow(change);
    }
    function emit(changes) {
        if (disposed)
            return;
        for (const change of changes) {
            const key = streamingKey(change);
            if (key !== null && isStreaming(change)) {
                pendingStreaming.set(key, change);
                if (flushTimer === null)
                    flushTimer = setTimeout(flushStreaming, coalesceMs);
                continue;
            }
            if (key !== null)
                pendingStreaming.delete(key);
            emitNow(change);
        }
    }
    return {
        get seq() {
            return seq;
        },
        emit,
        emitNow,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose() {
            disposed = true;
            if (flushTimer !== null)
                clearTimeout(flushTimer);
            flushTimer = null;
            pendingStreaming.clear();
            listeners.clear();
        },
    };
}
