import { validatePrompts } from "./prompts.mjs";
import { isPlainObject } from "./validation.mjs";
import { validateContextState } from "./context.mjs";
import { validateQueueState } from "./queue.mjs";
import { ATTACHMENT_LIMITS, validateTranscriptAttachment, } from "./attachments.mjs";
import { ACTIVITY_LIMITS, validateActivity } from "./activity.mjs";
export const PHASES = Object.freeze(["idle", "working", "waiting"]);
export const ACTIVITIES = Object.freeze([
    "thinking",
    "responding",
    "tool",
]);
export const WAITING_FOR = Object.freeze([
    "permission",
    "input",
    "elicitation",
    "plan",
]);
export const ENTRY_KINDS = Object.freeze([
    "user",
    "assistant",
    "error",
]);
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
    if (entry.attachments !== undefined &&
        (!Array.isArray(entry.attachments) ||
            entry.attachments.length > ATTACHMENT_LIMITS.maxCount ||
            !entry.attachments.every(validateTranscriptAttachment)))
        return false;
    return true;
}
export function validateStatus(status) {
    if (!isPlainObject(status))
        return false;
    if (!PHASES.includes(status.phase))
        return false;
    if (status.activity !== undefined && !ACTIVITIES.includes(status.activity)) {
        return false;
    }
    if (status.toolName !== undefined && typeof status.toolName !== "string")
        return false;
    if (status.waitingFor !== undefined && !WAITING_FOR.includes(status.waitingFor)) {
        return false;
    }
    if (status.intent !== undefined &&
        (typeof status.intent !== "string" || status.intent.length > ACTIVITY_LIMITS.maxDetailChars)) {
        return false;
    }
    return true;
}
export function validateSnapshot(snapshot) {
    return (isPlainObject(snapshot) &&
        Array.isArray(snapshot.entries) &&
        snapshot.entries.every(validateEntry) &&
        validateStatus(snapshot.status) &&
        (snapshot.prompts === undefined || validatePrompts(snapshot.prompts)) &&
        (snapshot.queue === undefined || validateQueueState(snapshot.queue)) &&
        (snapshot.context === undefined || validateContextState(snapshot.context)) &&
        (snapshot.activity === undefined || validateActivity(snapshot.activity)));
}
