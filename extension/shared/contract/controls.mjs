import { ERROR_CODES } from "./errors.mjs";
import { isPlainObject, makeError, SESSION_ID_PATTERN, } from "./validation.mjs";
export const SESSION_MODES = Object.freeze([
    "interactive",
    "plan",
    "autopilot",
]);
export const CONTEXT_TIERS = Object.freeze([
    "default",
    "long_context",
]);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;
export function validateControls(controls) {
    return (isPlainObject(controls) &&
        isPlainObject(controls.available) &&
        Array.isArray(controls.models) &&
        (controls.mode === undefined || SESSION_MODES.includes(controls.mode)));
}
/** Validates the body of POST api/controls: { sessionId, change } with exactly one change key. */
export function validateControlsPayload(body) {
    if (!isPlainObject(body) || !isPlainObject(body.change)) {
        return makeError(ERROR_CODES.badRequest, "Body must be { sessionId, change }.");
    }
    if (Object.keys(body).some((key) => key !== "sessionId" && key !== "change")) {
        return makeError(ERROR_CODES.badRequest, "Unexpected field.");
    }
    const { sessionId, change } = body;
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
        return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
    }
    const keys = Object.keys(change);
    if (keys.length !== 1) {
        return makeError(ERROR_CODES.badRequest, "change must have exactly one key.");
    }
    const value = change[keys[0]];
    switch (keys[0]) {
        case "mode":
            if (SESSION_MODES.includes(value)) {
                return { ok: true, value: { sessionId, change: { mode: value } } };
            }
            break;
        case "modelId":
            if (typeof value === "string" && MODEL_ID_PATTERN.test(value)) {
                return { ok: true, value: { sessionId, change: { modelId: value } } };
            }
            break;
        case "reasoningEffort":
            if (typeof value === "string" && EFFORT_PATTERN.test(value)) {
                return { ok: true, value: { sessionId, change: { reasoningEffort: value } } };
            }
            break;
        case "contextTier":
            if (CONTEXT_TIERS.includes(value)) {
                return { ok: true, value: { sessionId, change: { contextTier: value } } };
            }
            break;
    }
    return makeError(ERROR_CODES.badRequest, "Unsupported or malformed change.");
}
