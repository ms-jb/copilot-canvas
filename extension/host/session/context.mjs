// Read-only context window usage for the canvas. Usage is only what the session
// reports (`session.usage_info`, `session.compaction_complete`, or `metadata.contextInfo` on
// request), never an estimate. Compaction events are observed, never initiated here.
import { CONTEXT_LIMITS, isPlainObject } from "../../shared/contract.mjs";
import { describeSessionError } from "../logging.mjs";
import { readWithTimeout } from "../read-timeout.mjs";
const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
function breakdown(data) {
    const parts = {};
    if (count(data.systemTokens))
        parts.systemTokens = data.systemTokens;
    if (count(data.conversationTokens))
        parts.conversationTokens = data.conversationTokens;
    if (count(data.toolDefinitionsTokens))
        parts.toolDefinitionsTokens = data.toolDefinitionsTokens;
    return parts;
}
/** `session.usage_info` data, or null when it lacks a usable figure. */
export function usageFromEvent(data) {
    if (!isPlainObject(data) || !count(data.currentTokens) || !count(data.tokenLimit))
        return null;
    if (data.tokenLimit === 0)
        return null;
    return {
        currentTokens: data.currentTokens,
        tokenLimit: data.tokenLimit,
        ...breakdown(data),
        ...(count(data.messagesLength) ? { messages: data.messagesLength } : {}),
    };
}
/** `metadata.contextInfo` result, or null while the session hasn't initialized. */
export function usageFromContextInfo(result) {
    const info = isPlainObject(result) ? result.contextInfo : undefined;
    if (!isPlainObject(info) || !count(info.totalTokens) || !count(info.promptTokenLimit))
        return null;
    if (info.promptTokenLimit === 0)
        return null;
    return {
        currentTokens: info.totalTokens,
        tokenLimit: info.promptTokenLimit,
        ...breakdown(info),
        ...(count(info.compactionThreshold) ? { compactionThreshold: info.compactionThreshold } : {}),
    };
}
export function createContextTracker(rpc, notify, { log = () => { }, now = () => new Date(), timeoutMs = CONTEXT_LIMITS.compactTimeoutMs, readTimeoutMs = CONTEXT_LIMITS.readTimeoutMs, } = {}) {
    const metadata = rpc?.metadata;
    const canRefresh = typeof metadata?.contextInfo === "function";
    let usage = null;
    let threshold;
    let compacting = false;
    let lastCompaction;
    let timer;
    let disposed = false;
    let revision = 0;
    let reading;
    const snapshot = () => ({
        usage: usage && threshold !== undefined ? { ...usage, compactionThreshold: threshold } : usage,
        compacting,
        ...(lastCompaction ? { lastCompaction } : {}),
        actions: { refresh: canRefresh },
    });
    const changed = () => {
        if (!disposed)
            notify(snapshot());
    };
    const setUsage = (next) => {
        revision += 1;
        if (next?.compactionThreshold !== undefined)
            threshold = next.compactionThreshold;
        // The threshold is a share of the limit; a different model makes the old one meaningless.
        else if (next && usage && next.tokenLimit !== usage.tokenLimit)
            threshold = undefined;
        usage = next;
    };
    const begin = () => {
        compacting = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!compacting)
                return;
            compacting = false;
            lastCompaction = { success: false, at: now().toISOString() };
            changed();
        }, timeoutMs);
        timer.unref?.();
    };
    const finish = (report) => {
        compacting = false;
        clearTimeout(timer);
        lastCompaction = { ...report, at: now().toISOString() };
    };
    function applyEvent(event) {
        if (disposed || event.agentId)
            return;
        const data = event.data ?? {};
        switch (event.type) {
            case "session.usage_info": {
                const next = usageFromEvent(data);
                if (!next)
                    return;
                setUsage(next);
                break;
            }
            case "session.compaction_start":
                if (compacting)
                    return;
                begin();
                break;
            case "session.compaction_complete": {
                const success = data.success === true;
                finish({
                    success,
                    ...(count(data.tokensRemoved) ? { tokensRemoved: data.tokensRemoved } : {}),
                    ...(count(data.messagesRemoved) ? { messagesRemoved: data.messagesRemoved } : {}),
                });
                const limit = count(data.tokenLimit) && data.tokenLimit > 0 ? data.tokenLimit : undefined;
                if (success && count(data.postCompactionTokens) && (limit ?? usage?.tokenLimit)) {
                    setUsage({
                        currentTokens: data.postCompactionTokens,
                        tokenLimit: (limit ?? usage?.tokenLimit),
                        ...breakdown(data),
                    });
                }
                break;
            }
            case "session.context_cleared":
                setUsage(null);
                void refresh();
                break;
            default:
                return;
        }
        changed();
    }
    function refresh() {
        if (reading)
            return reading;
        reading = read().finally(() => {
            reading = undefined;
        });
        return reading;
    }
    async function read() {
        if (!canRefresh || disposed)
            return "unavailable";
        const version = revision;
        try {
            const result = await readWithTimeout(() => metadata.contextInfo.call(metadata, {
                promptTokenLimit: 0,
                outputTokenLimit: 0,
            }), readTimeoutMs);
            const next = usageFromContextInfo(result);
            if (!next)
                return "failed";
            if (!disposed && revision === version) {
                setUsage(next);
                changed();
            }
            return "refreshed";
        }
        catch (error) {
            log(`Could not read context usage: ${describeSessionError(error)}`, "warning");
            return "failed";
        }
    }
    return {
        snapshot,
        applyEvent,
        refresh,
        dispose() {
            disposed = true;
            clearTimeout(timer);
        },
    };
}
