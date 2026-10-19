import { ERROR_CODES } from "./errors.mjs";
import { LIMITS } from "./limits.mjs";
import { isOptionalString, isPlainObject, isString, isStringList, makeError, onlyKeys, SESSION_ID_PATTERN, } from "./validation.mjs";
export const PLAN_ACTIONS = Object.freeze([
    "exit_only",
    "interactive",
    "autopilot",
    "autopilot_fleet",
]);
const PROMPT_KINDS = ["permission", "question", "form", "plan"];
const PERMISSION_KINDS = [
    "command",
    "write",
    "read",
    "path",
    "url",
    "mcp",
    "tool",
    "memory",
    "extension",
    "workflow",
    "other",
];
const FORM_FIELD_TYPES = [
    "string",
    "number",
    "integer",
    "boolean",
    "enum",
];
const PROMPT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const FORM_FIELD_NAME_MAX = 128;
function validateFormField(field) {
    if (!isPlainObject(field))
        return false;
    if (!isString(field.name) || !isString(field.label))
        return false;
    if (!FORM_FIELD_TYPES.includes(field.type))
        return false;
    if (typeof field.required !== "boolean" || !isOptionalString(field.description))
        return false;
    if (field.options !== undefined) {
        if (!Array.isArray(field.options))
            return false;
        if (!field.options.every((o) => isPlainObject(o) && isString(o.value) && isString(o.label))) {
            return false;
        }
    }
    return true;
}
/** Structural check of one pending prompt as sent to the renderer. */
export function validatePrompt(prompt) {
    if (!isPlainObject(prompt))
        return false;
    if (!PROMPT_KINDS.includes(prompt.kind))
        return false;
    if (!isString(prompt.requestId) || !PROMPT_REQUEST_ID_PATTERN.test(prompt.requestId)) {
        return false;
    }
    if (!isString(prompt.createdAt))
        return false;
    switch (prompt.kind) {
        case "permission":
            return (PERMISSION_KINDS.includes(prompt.permission) &&
                isString(prompt.detail) &&
                isOptionalString(prompt.subject) &&
                isOptionalString(prompt.intent) &&
                isOptionalString(prompt.warning));
        case "question":
            return (isString(prompt.question) &&
                isStringList(prompt.choices) &&
                typeof prompt.allowFreeform === "boolean");
        case "form":
            return (isString(prompt.message) &&
                isOptionalString(prompt.source) &&
                typeof prompt.supported === "boolean" &&
                Array.isArray(prompt.fields) &&
                prompt.fields.every(validateFormField));
        default:
            return (isString(prompt.summary) &&
                isString(prompt.plan) &&
                Array.isArray(prompt.actions) &&
                prompt.actions.every((action) => PLAN_ACTIONS.includes(action)) &&
                (prompt.recommended === undefined ||
                    PLAN_ACTIONS.includes(prompt.recommended)));
    }
}
export function validatePrompts(prompts) {
    return Array.isArray(prompts) && prompts.every(validatePrompt);
}
function validateAnswerText(value, allowEmpty = false) {
    return (isString(value) &&
        value.length <= LIMITS.maxAnswerChars &&
        (allowEmpty || value.trim().length > 0));
}
function validatePromptResponse(response) {
    if (!isPlainObject(response))
        return null;
    switch (response.kind) {
        case "permission":
            if (!onlyKeys(response, ["kind", "decision"]))
                return null;
            return response.decision === "approve" || response.decision === "deny"
                ? { kind: "permission", decision: response.decision }
                : null;
        case "question":
            if (!onlyKeys(response, ["kind", "answer", "freeform"]))
                return null;
            if (!validateAnswerText(response.answer) || typeof response.freeform !== "boolean") {
                return null;
            }
            return { kind: "question", answer: response.answer, freeform: response.freeform };
        case "form": {
            if (!onlyKeys(response, ["kind", "action", "values"]))
                return null;
            const { action, values } = response;
            if (action !== "accept" && action !== "decline" && action !== "cancel")
                return null;
            if (values === undefined)
                return { kind: "form", action };
            if (action !== "accept" || !isPlainObject(values))
                return null;
            const entries = Object.entries(values);
            if (entries.length > LIMITS.maxFormFields)
                return null;
            const clean = {};
            for (const [name, value] of entries) {
                if (name.length === 0 || name.length > FORM_FIELD_NAME_MAX)
                    return null;
                const ok = typeof value === "boolean" ||
                    (typeof value === "number" && Number.isFinite(value)) ||
                    validateAnswerText(value, true);
                if (!ok)
                    return null;
                Object.defineProperty(clean, name, { value, enumerable: true, writable: true });
            }
            return { kind: "form", action, values: clean };
        }
        case "plan":
            if (!onlyKeys(response, ["kind", "approved", "action", "feedback"]))
                return null;
            if (response.approved === true) {
                if (response.feedback !== undefined)
                    return null;
                return PLAN_ACTIONS.includes(response.action)
                    ? { kind: "plan", approved: true, action: response.action }
                    : null;
            }
            if (response.approved !== false || response.action !== undefined)
                return null;
            if (response.feedback === undefined)
                return { kind: "plan", approved: false };
            return validateAnswerText(response.feedback, true)
                ? { kind: "plan", approved: false, feedback: response.feedback }
                : null;
        default:
            return null;
    }
}
/**
 * Validates the body of POST api/respond: { sessionId, requestId, response } where `response` is
 * one explicit decision of a known kind. Unknown keys anywhere are rejected. Whether the answer
 * fits the actual prompt (choices, fields, actions) is checked by the host against the prompt.
 */
export function validateRespondPayload(body) {
    if (!isPlainObject(body) || !onlyKeys(body, ["sessionId", "requestId", "response"])) {
        return makeError(ERROR_CODES.badRequest, "Body must be { sessionId, requestId, response }.");
    }
    const { sessionId, requestId } = body;
    if (!isString(sessionId) || !SESSION_ID_PATTERN.test(sessionId)) {
        return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
    }
    if (!isString(requestId) || !PROMPT_REQUEST_ID_PATTERN.test(requestId)) {
        return makeError(ERROR_CODES.badRequest, "requestId is missing or malformed.");
    }
    const response = validatePromptResponse(body.response);
    if (!response)
        return makeError(ERROR_CODES.badRequest, "Unsupported or malformed response.");
    return { ok: true, value: { sessionId, requestId, response } };
}
