import { ERROR_CODES } from "./errors.mjs";
import { isPlainObject, makeError, onlyKeys, SESSION_ID_PATTERN, } from "./validation.mjs";
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_ID = /^[\w.:-]{1,128}$/;
export const QUEUE_LIMITS = Object.freeze({ maxItems: 200, maxTextChars: 2000 });
export function validateQueueState(value) {
    return (isPlainObject(value) &&
        Array.isArray(value.removedRequestIds) &&
        value.removedRequestIds.length <= 500 &&
        value.removedRequestIds.every((id) => typeof id === "string" && REQUEST_ID.test(id)) &&
        (value.items === undefined ||
            (Array.isArray(value.items) &&
                value.items.length <= QUEUE_LIMITS.maxItems &&
                value.items.every((item) => isPlainObject(item) &&
                    typeof item.id === "string" &&
                    ITEM_ID.test(item.id) &&
                    (item.requestId === undefined ||
                        (typeof item.requestId === "string" && REQUEST_ID.test(item.requestId))) &&
                    (item.kind === "message" || item.kind === "command") &&
                    typeof item.text === "string" &&
                    (item.truncated === undefined || typeof item.truncated === "boolean") &&
                    item.text.length <= QUEUE_LIMITS.maxTextChars))));
}
/** Validates POST api/queue: { sessionId, action, id, text? | toPosition? }. */
export function validateQueuePayload(body) {
    if (!isPlainObject(body) ||
        !onlyKeys(body, ["sessionId", "action", "id", "text", "toPosition"])) {
        return makeError(ERROR_CODES.badRequest, "Body must be { sessionId, action, id }.");
    }
    const { sessionId, action, id, text, toPosition } = body;
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
        return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
    }
    if (typeof id !== "string" || !ITEM_ID.test(id)) {
        return makeError(ERROR_CODES.badRequest, "id is missing or malformed.");
    }
    if (action === "remove" && text === undefined && toPosition === undefined) {
        return { ok: true, value: { sessionId, change: { action, id } } };
    }
    if (action === "edit" && toPosition === undefined) {
        if (typeof text !== "string" || !text.trim() || text.length > QUEUE_LIMITS.maxTextChars) {
            return makeError(ERROR_CODES.badRequest, "text must be a non-empty string.");
        }
        return { ok: true, value: { sessionId, change: { action, id, text } } };
    }
    if (action === "move" && text === undefined) {
        if (!Number.isSafeInteger(toPosition) ||
            toPosition < 0 ||
            toPosition >= QUEUE_LIMITS.maxItems) {
            return makeError(ERROR_CODES.badRequest, "toPosition must be a non-negative integer.");
        }
        return {
            ok: true,
            value: { sessionId, change: { action, id, toPosition: toPosition } },
        };
    }
    return makeError(ERROR_CODES.badRequest, "action must be remove, edit or move.");
}
