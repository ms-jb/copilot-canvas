import { validateControls } from "./controls.mjs";
import { ERROR_CODES } from "./errors.mjs";
import { LIMITS } from "./limits.mjs";
import { validatePrompts } from "./prompts.mjs";
import { validateEntry, validateSnapshot, validateStatus, } from "./transcript.mjs";
import { isPlainObject, makeError, SESSION_ID_PATTERN, } from "./validation.mjs";
export const CONTRACT_VERSION = 2;
export const IDENTITY_APP = "copilot-canvas";
// Paths are relative to the provider's capability prefix (or to the gateway root).
export const API = Object.freeze({
    identity: "api/identity",
    bootstrap: "api/bootstrap",
    events: "api/events",
    send: "api/send",
    controls: "api/controls",
    share: "api/share",
    respond: "api/respond",
    reload: "api/reload",
    stop: "api/stop",
    // Served by the gateway itself (phone only), never forwarded to the provider.
    pushKey: "api/push/key",
    pushSubscribe: "api/push/subscribe",
    pushUnsubscribe: "api/push/unsubscribe",
    pushTest: "api/push/test",
    pushLatest: "api/push/latest",
    pushPresence: "api/push/presence",
});
export const HEADERS = Object.freeze({
    generation: "x-provider-generation",
    csrf: "x-csrf-token",
});
export const SSE_EVENTS = Object.freeze({
    snapshot: "snapshot",
    entry: "entry",
    status: "status",
    controls: "controls",
    prompts: "prompts",
});
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/**
 * Validates the body of POST api/send. Accepts exactly { requestId, sessionId, text };
 * unknown keys are rejected.
 */
export function validateSendPayload(body) {
    if (!isPlainObject(body)) {
        return makeError(ERROR_CODES.badRequest, "Body must be a JSON object.");
    }
    const allowed = new Set(["requestId", "sessionId", "text"]);
    for (const key of Object.keys(body)) {
        if (!allowed.has(key)) {
            return makeError(ERROR_CODES.badRequest, `Unexpected field: ${key}.`);
        }
    }
    const { requestId, sessionId, text } = body;
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
        return makeError(ERROR_CODES.badRequest, "requestId is missing or malformed.");
    }
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
        return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
    }
    if (typeof text !== "string") {
        return makeError(ERROR_CODES.badRequest, "text must be a string.");
    }
    if (text.trim().length === 0) {
        return makeError(ERROR_CODES.badRequest, "text must not be empty.");
    }
    if (text.length > LIMITS.maxPromptChars) {
        return makeError(ERROR_CODES.payloadTooLarge, `text exceeds ${LIMITS.maxPromptChars} characters.`);
    }
    return { ok: true, value: { requestId, sessionId, text } };
}
/** Validates the body of POST api/reload or api/stop: { sessionId }. */
export function validateReloadPayload(body) {
    if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "sessionId")) {
        return makeError(ERROR_CODES.badRequest, "Body must be { sessionId }.");
    }
    const { sessionId } = body;
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
        return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
    }
    return { ok: true, value: { sessionId } };
}
/** Validates a parsed SSE payload for the named event. */
export function validateServerEvent(name, data) {
    if (!isPlainObject(data) || !Number.isInteger(data.seq) || data.seq < 0)
        return false;
    switch (name) {
        case SSE_EVENTS.snapshot:
            return (typeof data.generation === "string" &&
                validateSnapshot(data.snapshot) &&
                validateControls(data.controls));
        case SSE_EVENTS.entry:
            return validateEntry(data.entry);
        case SSE_EVENTS.status:
            return validateStatus(data.status);
        case SSE_EVENTS.controls:
            return validateControls(data.controls);
        case SSE_EVENTS.prompts:
            return validatePrompts(data.prompts);
        default:
            return false;
    }
}
/** Validates the body of GET api/bootstrap. */
export function validateBootstrap(body) {
    return (isPlainObject(body) &&
        body.contractVersion === CONTRACT_VERSION &&
        typeof body.generation === "string" &&
        typeof body.sessionId === "string" &&
        typeof body.csrfToken === "string" &&
        isPlainObject(body.config) &&
        typeof body.config.assistantName === "string" &&
        (body.config.sourceDir === undefined || typeof body.config.sourceDir === "string") &&
        validateSnapshot(body.snapshot) &&
        validateControls(body.controls));
}
/** Returns only the scheme://host[:port] of an http(s) URL, or null. Never keeps a path or query. */
export function toPublicOrigin(value) {
    if (typeof value !== "string" || value.trim() === "")
        return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    }
    catch {
        return null;
    }
}
/** Validates the body of GET api/identity (no CSRF token, no transcript data). */
export function validateIdentity(body) {
    return (isPlainObject(body) &&
        body.app === IDENTITY_APP &&
        body.contractVersion === CONTRACT_VERSION &&
        typeof body.generation === "string");
}
