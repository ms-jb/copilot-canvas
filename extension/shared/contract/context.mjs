import { isPlainObject } from "./validation.mjs";
export const CONTEXT_LIMITS = Object.freeze({
    readTimeoutMs: 5000,
    /** A compaction the session never reports finished is given up on after this long. */
    compactTimeoutMs: 180000,
});
const count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const optionalCount = (value) => value === undefined || count(value);
export function validateContextUsage(value) {
    return (isPlainObject(value) &&
        count(value.currentTokens) &&
        count(value.tokenLimit) &&
        value.tokenLimit > 0 &&
        optionalCount(value.systemTokens) &&
        optionalCount(value.conversationTokens) &&
        optionalCount(value.toolDefinitionsTokens) &&
        optionalCount(value.messages) &&
        optionalCount(value.compactionThreshold));
}
export function validateContextState(value) {
    if (!isPlainObject(value) || !isPlainObject(value.actions))
        return false;
    const last = value.lastCompaction;
    return ((value.usage === null || validateContextUsage(value.usage)) &&
        typeof value.compacting === "boolean" &&
        typeof value.actions.refresh === "boolean" &&
        (last === undefined ||
            (isPlainObject(last) &&
                typeof last.success === "boolean" &&
                typeof last.at === "string" &&
                optionalCount(last.tokensRemoved) &&
                optionalCount(last.messagesRemoved))));
}
