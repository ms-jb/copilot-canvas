// Shared wire contract between the extension host (provider), the renderer and the gateway.
// Pure TypeScript, no dependencies, safe to import from Node and from the browser bundle.
export const CONTRACT_VERSION = 1;
export const IDENTITY_APP = "copilot-canvas-starter";
// Paths are relative to the provider's capability prefix (or to the gateway root).
export const API = Object.freeze({
    identity: "api/identity",
    bootstrap: "api/bootstrap",
    events: "api/events",
    send: "api/send",
});
export const HEADERS = Object.freeze({
    generation: "x-provider-generation",
    csrf: "x-csrf-token",
});
export const LIMITS = Object.freeze({
    maxPromptChars: 20000,
    maxBodyBytes: 64 * 1024,
    sendTimeoutMs: 30000,
    keepaliveMs: 15000,
    maxEntries: 500,
});
export const ERROR_CODES = Object.freeze({
    badRequest: "bad_request",
    forbidden: "forbidden",
    notFound: "not_found",
    methodNotAllowed: "method_not_allowed",
    unsupportedMediaType: "unsupported_media_type",
    payloadTooLarge: "payload_too_large",
    sessionMismatch: "session_mismatch",
    staleProvider: "stale_provider",
    duplicateRequest: "duplicate_request",
    sendFailed: "send_failed",
    sendUncertain: "send_uncertain",
    notConnected: "not_connected",
    internal: "internal_error",
});
export const HTTP_STATUS_BY_CODE = Object.freeze({
    [ERROR_CODES.badRequest]: 400,
    [ERROR_CODES.forbidden]: 403,
    [ERROR_CODES.notFound]: 404,
    [ERROR_CODES.methodNotAllowed]: 405,
    [ERROR_CODES.unsupportedMediaType]: 415,
    [ERROR_CODES.payloadTooLarge]: 413,
    [ERROR_CODES.sessionMismatch]: 409,
    [ERROR_CODES.staleProvider]: 409,
    [ERROR_CODES.duplicateRequest]: 409,
    [ERROR_CODES.sendFailed]: 502,
    [ERROR_CODES.sendUncertain]: 504,
    [ERROR_CODES.notConnected]: 503,
    [ERROR_CODES.internal]: 500,
});
// Outcome of a send attempt as reported to the renderer.
export const SEND_STATUS = Object.freeze({
    accepted: "accepted",
    rejected: "rejected",
    uncertain: "uncertain",
});
export const SSE_EVENTS = Object.freeze({
    snapshot: "snapshot",
    entry: "entry",
    status: "status",
});
export const PHASES = Object.freeze(["idle", "working", "waiting"]);
export const WAITING_FOR = Object.freeze([
    "permission",
    "input",
    "elicitation",
]);
export const ENTRY_KINDS = Object.freeze([
    "user",
    "assistant",
    "error",
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function makeError(code, message, extra = {}) {
    return { ok: false, code, message, ...extra };
}
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
export function validateEntry(entry) {
    if (!isPlainObject(entry))
        return false;
    if (typeof entry.id !== "string" || entry.id.length === 0)
        return false;
    if (!ENTRY_KINDS.includes(entry.kind))
        return false;
    if (typeof entry.text !== "string")
        return false;
    if (typeof entry.timestamp !== "string")
        return false;
    if (entry.streaming !== undefined && typeof entry.streaming !== "boolean")
        return false;
    if (entry.requestId !== undefined && typeof entry.requestId !== "string")
        return false;
    return true;
}
export function validateStatus(status) {
    if (!isPlainObject(status))
        return false;
    if (!PHASES.includes(status.phase))
        return false;
    if (status.waitingFor !== undefined && !WAITING_FOR.includes(status.waitingFor)) {
        return false;
    }
    return true;
}
export function validateSnapshot(snapshot) {
    return (isPlainObject(snapshot) &&
        Array.isArray(snapshot.entries) &&
        snapshot.entries.every(validateEntry) &&
        validateStatus(snapshot.status));
}
/** Validates a parsed SSE payload for the named event. */
export function validateServerEvent(name, data) {
    if (!isPlainObject(data) || !Number.isInteger(data.seq) || data.seq < 0)
        return false;
    switch (name) {
        case SSE_EVENTS.snapshot:
            return typeof data.generation === "string" && validateSnapshot(data.snapshot);
        case SSE_EVENTS.entry:
            return validateEntry(data.entry);
        case SSE_EVENTS.status:
            return validateStatus(data.status);
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
        typeof body.config.displayName === "string" &&
        validateSnapshot(body.snapshot));
}
/** Validates the body of GET api/identity (no CSRF token, no transcript data). */
export function validateIdentity(body) {
    return (isPlainObject(body) &&
        body.app === IDENTITY_APP &&
        body.contractVersion === CONTRACT_VERSION &&
        typeof body.generation === "string");
}
