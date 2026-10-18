import { isPlainObject, QUEUE_LIMITS, } from "../../shared/contract.mjs";
import { readWithTimeout } from "../read-timeout.mjs";
/** Reconcile only sends we admitted, never infer queue removal from an idle status alone. */
export function createQueueTracker(rpc, notify, { timeoutMs = 5000, sendImmediate } = {}) {
    const pending = new Map();
    const confirmed = new Set();
    const removed = new Set();
    const sentNow = new Map();
    let items = [];
    let shown = "[]";
    let disposed = false;
    let reading;
    let dirty = false;
    const snapshot = () => ({ removedRequestIds: [...removed], items });
    const requestFor = (messageId) => [...pending].find(([, id]) => id === messageId)?.[0];
    const remember = (set, value) => {
        set.add(value);
        if (set.size > 500)
            set.delete(set.values().next().value);
    };
    const isoTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
    const rememberSendNow = (requestId, outcome) => {
        sentNow.set(requestId, outcome);
        if (sentNow.size > 500)
            sentNow.delete(sentNow.keys().next().value);
        return outcome;
    };
    function refresh() {
        if (disposed || typeof rpc?.pendingItems !== "function")
            return Promise.resolve(false);
        if (reading) {
            dirty = true;
            return reading;
        }
        return (reading = read());
    }
    async function read() {
        if (typeof rpc?.pendingItems !== "function")
            return false;
        // A read that started before another send was admitted cannot remove that later send.
        const candidates = [...pending];
        try {
            const queue = await readWithTimeout(() => rpc.pendingItems(), timeoutMs);
            if (disposed ||
                !isPlainObject(queue) ||
                !Array.isArray(queue.items) ||
                queue.items.length > 1000 ||
                !Array.isArray(queue.steeringMessages) ||
                !queue.steeringMessages.every((value) => typeof value === "string") ||
                (queue.withdrawableTurnMessageId !== undefined &&
                    typeof queue.withdrawableTurnMessageId !== "string") ||
                !queue.items.every((item) => isPlainObject(item) &&
                    ((item.kind === "message" &&
                        typeof item.messageId === "string" &&
                        item.messageId.length > 0) ||
                        item.kind === "command")))
                return false;
            const held = new Set(queue.items.map((item) => item.messageId));
            // The session may not report when an item was queued, so keep the first time this host saw it.
            const queuedAtById = new Map(items.map((item) => [item.id, item.queuedAt]));
            const seenAt = new Date().toISOString();
            // The page's request ids stay attached to items so every client can tell its own sends.
            const ids = new Set();
            const next = queue.items
                .flatMap((item) => {
                if (typeof item.id !== "string" || !/^[\w.:-]{1,128}$/.test(item.id) || ids.has(item.id))
                    return [];
                ids.add(item.id);
                const requestId = typeof item.messageId === "string" ? requestFor(item.messageId) : undefined;
                const queuedAt = isoTime(item.queuedAt) ??
                    isoTime(item.createdAt) ??
                    queuedAtById.get(item.id) ??
                    seenAt;
                return [
                    {
                        id: item.id,
                        ...(requestId ? { requestId } : {}),
                        kind: item.kind,
                        text: typeof item.displayText === "string"
                            ? item.displayText.slice(0, QUEUE_LIMITS.maxTextChars)
                            : "",
                        ...(typeof item.displayText === "string" &&
                            item.displayText.length > QUEUE_LIMITS.maxTextChars
                            ? { truncated: true }
                            : {}),
                        queuedAt,
                    },
                ];
            })
                .slice(0, QUEUE_LIMITS.maxItems);
            let changed = false;
            const key = JSON.stringify(next);
            if (key !== shown) {
                shown = key;
                items = next;
                changed = true;
            }
            for (const [requestId, messageId] of candidates) {
                if (pending.get(requestId) !== messageId ||
                    confirmed.has(messageId) ||
                    held.has(messageId) ||
                    queue.withdrawableTurnMessageId === messageId)
                    continue;
                pending.delete(requestId);
                remember(removed, requestId);
                changed = true;
            }
            if (changed)
                notify(snapshot());
            return true;
        }
        catch {
            // Experimental RPC failures leave pending messages visible; never invent a removal.
            return false;
        }
        finally {
            reading = undefined;
            if (dirty && !disposed) {
                dirty = false;
                void refresh();
            }
        }
    }
    let lock = Promise.resolve();
    // A read already in flight may predate the caller's action, so wait it out and read again.
    async function freshRead() {
        await reading;
        if (!(await refresh()))
            throw new Error("Queue could not be refreshed.");
    }
    /** Sends the item's text as a normal message, then drops it from the queue; a repeat request id replays the outcome. */
    async function sendNow(change) {
        const replay = sentNow.get(change.requestId);
        if (replay)
            return replay;
        if (disposed ||
            typeof sendImmediate !== "function" ||
            typeof rpc?.removeAt !== "function" ||
            typeof rpc.pendingItems !== "function")
            return "unavailable";
        try {
            await freshRead();
            if (disposed)
                return "unavailable";
            const item = items.find((candidate) => candidate.id === change.id);
            if (!item)
                return rememberSendNow(change.requestId, "gone");
            // A clipped copy would send a partial message.
            if (item.kind !== "message" || item.truncated)
                return "unavailable";
            if (!(await sendImmediate(item.text, change.requestId))) {
                return rememberSendNow(change.requestId, "failed");
            }
            const result = await readWithTimeout(() => rpc.removeAt({ id: change.id }), timeoutMs);
            await freshRead();
            const gone = isPlainObject(result) && result.removed === false;
            return rememberSendNow(change.requestId, gone ? "gone" : "done");
        }
        catch {
            return rememberSendNow(change.requestId, "failed");
        }
    }
    async function apply(change) {
        if (change.action === "send_now")
            return sendNow(change);
        const method = change.action === "remove"
            ? rpc?.removeAt
            : change.action === "edit"
                ? rpc?.updateText
                : rpc?.moveItem;
        if (disposed || typeof method !== "function" || typeof rpc?.pendingItems !== "function")
            return "unavailable";
        try {
            await freshRead();
            if (disposed)
                return "unavailable";
            const item = items.find((item) => item.id === change.id);
            if (!item)
                return "gone";
            if (change.action === "edit" && (item.kind !== "message" || item.truncated))
                return "unavailable";
            const result = await readWithTimeout(() => change.action === "remove"
                ? rpc.removeAt({ id: change.id })
                : change.action === "edit"
                    ? rpc.updateText({ id: change.id, prompt: change.text })
                    : rpc.moveItem({ id: change.id, toPosition: change.toPosition }), timeoutMs);
            await freshRead();
            if (change.action === "remove" && isPlainObject(result) && result.removed === false)
                return "gone";
            return "done";
        }
        catch {
            return "failed";
        }
    }
    return {
        snapshot,
        refresh,
        admitted(messageId, requestId) {
            if (disposed || confirmed.has(messageId))
                return;
            pending.set(requestId, messageId);
            if (pending.size > 500)
                pending.delete(pending.keys().next().value);
            void refresh();
        },
        confirmed(messageId) {
            remember(confirmed, messageId);
            for (const [requestId, id] of pending)
                if (id === messageId)
                    pending.delete(requestId);
        },
        /** Mutations run one at a time against a fresh read, so two clients can't act on a stale list. */
        async change(change) {
            const run = lock.then(() => apply(change));
            lock = run.then(() => undefined, () => undefined);
            return run;
        },
        dispose() {
            disposed = true;
            pending.clear();
            confirmed.clear();
            removed.clear();
        },
    };
}
