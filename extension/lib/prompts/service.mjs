// Session events/read-back are authoritative. Only explicit user decisions reach the adapter.
import { ERROR_CODES, LIMITS } from "../../shared/contract.mjs";
import { describePermission, describePlan, describeQuestion, isRecord } from "./descriptions.mjs";
import { describeForm } from "./form-schema.mjs";
import { createPromptsRpcAdapter, describeError, rejected, RESOLVED_MESSAGE, } from "./rpc-adapter.mjs";
export function createPromptService(session, { log = () => { }, timeoutMs = LIMITS.respondTimeoutMs, refreshIntervalMs = 1000, } = {}) {
    const rpc = createPromptsRpcAdapter(session, { log, timeoutMs });
    const { can } = rpc;
    const pending = new Map();
    const settled = new Set();
    const answering = new Set();
    const listeners = new Set();
    let mark = 0;
    let disposed = false;
    let refreshing = false;
    let refreshQueued = false;
    let lastRefreshAt = 0;
    let refreshTimer = null;
    function list() {
        return [...pending.values()]
            .slice(-LIMITS.maxPrompts)
            .map((tracked) => structuredClone(tracked.prompt));
    }
    function notify() {
        if (disposed)
            return;
        const prompts = list();
        for (const listener of Array.from(listeners)) {
            try {
                listener(prompts);
            }
            catch (error) {
                log(`Prompt listener failed: ${describeError(error)}`, "warning");
            }
        }
    }
    function settle(requestId) {
        settled.add(requestId);
        if (settled.size > 500)
            settled.delete(settled.values().next().value);
    }
    function add(prompt) {
        if (disposed || settled.has(prompt.requestId))
            return;
        const existing = pending.get(prompt.requestId);
        mark += 1;
        pending.set(prompt.requestId, { prompt, mark: existing?.mark ?? mark });
        notify();
    }
    function drop(requestId) {
        settle(requestId);
        if (pending.delete(requestId))
            notify();
    }
    function dropWhere(test) {
        let changed = false;
        for (const [requestId, tracked] of pending) {
            if (!test(tracked.prompt))
                continue;
            settle(requestId);
            pending.delete(requestId);
            changed = true;
        }
        if (changed)
            notify();
    }
    function applyEvent(event) {
        if (disposed || !event || typeof event.type !== "string")
            return;
        const data = isRecord(event.data) ? event.data : {};
        const requestId = typeof data.requestId === "string" && data.requestId.length > 0 ? data.requestId : null;
        const createdAt = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
        switch (event.type) {
            case "permission.requested":
                if (!requestId || !can.permission())
                    return;
                // Already decided by a hook: nothing to ask.
                if (data.resolvedByHook === true)
                    return settle(requestId);
                return add(describePermission(requestId, createdAt, data.promptRequest ?? data.permissionRequest));
            case "user_input.requested":
                if (requestId && can.question())
                    add(describeQuestion(requestId, createdAt, data));
                return;
            case "elicitation.requested":
                if (requestId && can.form())
                    add(describeForm(requestId, createdAt, data));
                return;
            case "exit_plan_mode.requested":
                if (requestId && can.plan())
                    add(describePlan(requestId, createdAt, data));
                return;
            case "permission.completed":
            case "user_input.completed":
            case "elicitation.completed":
            case "exit_plan_mode.completed":
                if (requestId)
                    drop(requestId);
                return;
            case "session.shutdown":
                if (!event.agentId)
                    dropWhere(() => true);
                return;
            case "session.idle":
            case "abort":
                // A finished turn can't still be asking; permissions are re-checked against the session.
                if (event.agentId)
                    return;
                dropWhere((prompt) => prompt.kind !== "permission");
                refresh();
                return;
            default:
                return;
        }
    }
    async function readPending() {
        if (!can.list() || !can.permission())
            return;
        const startMark = mark;
        let result;
        try {
            result = await rpc.readPending();
        }
        catch (error) {
            log(`Could not read pending permission requests: ${describeError(error)}`, "warning");
            return;
        }
        if (disposed)
            return;
        const items = isRecord(result) && Array.isArray(result.items) ? result.items : [];
        const live = new Set();
        let changed = false;
        for (const item of items) {
            if (!isRecord(item) || typeof item.requestId !== "string" || !item.requestId)
                continue;
            live.add(item.requestId);
            if (pending.has(item.requestId) || settled.has(item.requestId))
                continue;
            mark += 1;
            const prompt = describePermission(item.requestId, new Date().toISOString(), item.request);
            pending.set(item.requestId, { prompt, mark });
            changed = true;
        }
        // Keep requests arriving during this read and answers still in flight.
        for (const [requestId, tracked] of pending) {
            if (tracked.prompt.kind !== "permission" || tracked.mark > startMark)
                continue;
            if (live.has(requestId) || answering.has(requestId))
                continue;
            settle(requestId);
            pending.delete(requestId);
            changed = true;
        }
        if (changed)
            notify();
    }
    function refresh() {
        if (disposed || !can.list())
            return;
        if (refreshing) {
            refreshQueued = true;
            return;
        }
        const wait = lastRefreshAt + refreshIntervalMs - Date.now();
        if (wait > 0) {
            if (refreshTimer === null) {
                refreshTimer = setTimeout(() => {
                    refreshTimer = null;
                    refresh();
                }, wait);
            }
            return;
        }
        refreshing = true;
        lastRefreshAt = Date.now();
        void runRefresh();
    }
    async function runRefresh() {
        try {
            await readPending();
        }
        finally {
            refreshing = false;
            if (refreshQueued && !disposed) {
                refreshQueued = false;
                refresh();
            }
        }
    }
    async function respond(requestId, response) {
        if (disposed)
            return rejected(ERROR_CODES.notConnected, "The session is no longer connected.");
        const tracked = pending.get(requestId);
        if (!tracked)
            return rejected(ERROR_CODES.promptResolved, RESOLVED_MESSAGE);
        // Synchronous guard: double taps and other clients cannot answer twice, even after timeout.
        if (answering.has(requestId)) {
            return rejected(ERROR_CODES.duplicateRequest, "This request is already being answered.");
        }
        const call = rpc.prepare(tracked.prompt, response);
        if (typeof call !== "function")
            return call;
        answering.add(requestId);
        return rpc.execute(call, (succeeded) => {
            answering.delete(requestId);
            // success:false also means no longer waiting (answered elsewhere or expired).
            if (succeeded)
                drop(requestId);
        });
    }
    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        if (refreshTimer !== null)
            clearTimeout(refreshTimer);
        rpc.dispose();
        pending.clear();
        listeners.clear();
    }
    let ready = Promise.resolve();
    if (can.list()) {
        refreshing = true;
        lastRefreshAt = Date.now();
        ready = runRefresh();
    }
    return { ready, list, subscribe, applyEvent, refresh, respond, dispose };
}
