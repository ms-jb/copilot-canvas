import { describeSessionError } from "../logging.mjs";
/** One sequence for transcript, controls and prompts; streaming entries alone are coalesced. */
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
        for (const entry of batch)
            emitNow({ type: "entry", entry });
    }
    function emit(changes) {
        if (disposed)
            return;
        for (const change of changes) {
            if (change.type === "entry" && change.entry.streaming === true) {
                pendingStreaming.set(change.entry.id, change.entry);
                if (flushTimer === null)
                    flushTimer = setTimeout(flushStreaming, coalesceMs);
                continue;
            }
            if (change.type === "entry")
                pendingStreaming.delete(change.entry.id);
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
