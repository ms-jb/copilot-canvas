// Session bridge: connects one joined Copilot session to the provider server.
//
// - Subscribes to live session events BEFORE reading history, then merges history (the
//   transcript store de-duplicates by event id, so the overlap is harmless).
// - Turns store changes into sequence-numbered change events for subscribers.
// - Coalesces streaming entry updates (~50ms) so SSE clients are not flooded.
// - Sends composer text through the joined session (never sendAndWait) with a timeout that
//   reports "uncertain" instead of ever re-sending.
// - Never answers permission or question events; it only mirrors them as a "waiting" status.
import { ERROR_CODES, LIMITS, SEND_STATUS } from "../shared/contract.mjs";
import { createTranscriptStore } from "../shared/transcript.mjs";
const DEFAULT_COALESCE_MS = 50;
const MAX_TRACKED_REQUESTS = 500;
const MAX_ERROR_MESSAGE = 300;
function describeError(error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const trimmed = message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE);
    return trimmed || "The session did not accept the message.";
}
export function createSessionBridge(session, { store = createTranscriptStore(), log = () => { }, coalesceMs = DEFAULT_COALESCE_MS, sendTimeoutMs = LIMITS.sendTimeoutMs, } = {}) {
    const listeners = new Set();
    const pendingStreaming = new Map();
    const requests = new Set();
    const cancelTimers = new Set();
    let seq = 0;
    let flushTimer = null;
    let disposed = false;
    function notify(event) {
        for (const listener of Array.from(listeners)) {
            try {
                listener(event);
            }
            catch (error) {
                log(`Bridge listener failed: ${describeError(error)}`, "warning");
            }
        }
    }
    function emitNow(change) {
        seq += 1;
        if (change.type === "entry") {
            notify({ seq, type: "entry", entry: { ...change.entry } });
        }
        else {
            notify({ seq, type: "status", status: { ...change.status } });
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
    function onSessionEvent(event) {
        try {
            emit(store.applyEvent(event));
        }
        catch (error) {
            log(`Failed to apply session event: ${describeError(error)}`, "warning");
        }
    }
    // Subscribe first; history is merged afterwards and overlaps are de-duplicated by the store.
    const unsubscribeSession = session.on(onSessionEvent);
    const ready = (async () => {
        try {
            const history = await session.getEvents();
            if (!disposed && Array.isArray(history))
                emit(store.mergeHistory(history));
        }
        catch (error) {
            log(`Could not load session history: ${describeError(error)}`, "warning");
        }
    })();
    function getSnapshot() {
        return { seq, snapshot: store.snapshot() };
    }
    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }
    function admit(messageId, requestId) {
        if (typeof messageId === "string" && messageId.length > 0) {
            emit(store.tagRequest(messageId, requestId));
        }
    }
    function remember(requestId) {
        requests.add(requestId);
        if (requests.size > MAX_TRACKED_REQUESTS) {
            const oldest = requests.values().next().value;
            if (oldest !== undefined)
                requests.delete(oldest);
        }
    }
    function uncertain(requestId, message) {
        return {
            ok: false,
            status: SEND_STATUS.uncertain,
            code: ERROR_CODES.sendUncertain,
            message,
            requestId,
        };
    }
    async function send(text, requestId) {
        if (disposed) {
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.sendFailed,
                message: "The session is no longer connected.",
                requestId,
            };
        }
        // Recorded before any await so a repeat can never reach session.send twice.
        if (requests.has(requestId)) {
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.duplicateRequest,
                message: "This request was already submitted.",
                requestId,
            };
        }
        remember(requestId);
        const attempt = Promise.resolve()
            .then(() => session.send({ prompt: text }))
            .then((messageId) => ({ messageId }), (error) => ({ error }));
        let timer;
        let cancel = () => { };
        const timedOut = new Promise((resolve) => {
            cancel = () => resolve("timeout");
            cancelTimers.add(cancel);
            timer = setTimeout(cancel, sendTimeoutMs);
        });
        const winner = await Promise.race([attempt, timedOut]);
        clearTimeout(timer);
        cancelTimers.delete(cancel);
        if (winner === "timeout") {
            // The send may still land; tag it when it does, but never re-send.
            void attempt.then((late) => {
                if ("error" in late) {
                    log(`Late send failure: ${describeError(late.error)}`, "warning");
                }
                else {
                    admit(late.messageId, requestId);
                }
            });
            return uncertain(requestId, "The session did not confirm the message in time. It might not have been delivered.");
        }
        if ("error" in winner) {
            requests.delete(requestId);
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.sendFailed,
                message: describeError(winner.error),
                requestId,
            };
        }
        admit(winner.messageId, requestId);
        const outcome = { ok: true, status: SEND_STATUS.accepted, requestId };
        if (typeof winner.messageId === "string")
            outcome.messageId = winner.messageId;
        return outcome;
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        try {
            unsubscribeSession();
        }
        catch {
            // Session may already be disconnected.
        }
        if (flushTimer !== null)
            clearTimeout(flushTimer);
        flushTimer = null;
        pendingStreaming.clear();
        for (const cancel of Array.from(cancelTimers))
            cancel();
        cancelTimers.clear();
        listeners.clear();
    }
    return { sessionId: session.sessionId, ready, getSnapshot, subscribe, send, dispose };
}
