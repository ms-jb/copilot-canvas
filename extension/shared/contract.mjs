// Shared wire contract between the extension host (provider), the renderer and the gateway.
// Pure TypeScript, no dependencies, safe to import from Node and from the browser bundle.
// Keep this compatibility entry point explicit; domain modules own their types and validators.
// Domain modules import each other directly, never this facade.
export { ATTACHMENT_EXTENSIONS, ATTACHMENT_LIMITS, attachmentByteLength, isAttachmentMimeType, isSafeAttachmentName, transcriptAttachments, validateAttachments, } from "./contract/attachments.mjs";
export { CONTEXT_TIERS, SESSION_MODES, validateControls, validateControlsPayload, } from "./contract/controls.mjs";
export { ERROR_CODES, HTTP_STATUS_BY_CODE, SEND_STATUS, } from "./contract/errors.mjs";
export { LIMITS } from "./contract/limits.mjs";
export { QUEUE_LIMITS, validateQueueState, validateQueuePayload, } from "./contract/queue.mjs";
export { ACTIVITY_LIMITS, pruneActivity, validateActivity, validateActivityItem, } from "./contract/activity.mjs";
export { CONTEXT_LIMITS, validateContextState, validateContextUsage, } from "./contract/context.mjs";
export { SKILL_LIMITS, isSkillName, parseSlashCommand, validateSkills, } from "./contract/skills.mjs";
export { APP_SESSION_ID, MAX_SESSIONS, validateSessions, } from "./contract/sessions.mjs";
export { PLAN_ACTIONS, validatePrompt, validatePrompts, validateRespondPayload, } from "./contract/prompts.mjs";
export { ACTIVE_HOURS_DEFAULT, deviceTimeZone, isWithinActiveHours, normalizeActiveHours, validatePushSettingsPayload, } from "./contract/push.mjs";
export { API, CONTRACT_VERSION, HEADERS, IDENTITY_APP, SSE_EVENTS, toPublicOrigin, validateBootstrap, validateIdentity, validateReloadPayload, validateSendPayload, validateServerEvent, } from "./contract/protocol.mjs";
export { ACTIVITIES, ENTRY_KINDS, PHASES, WAITING_FOR, validateEntry, validateSnapshot, validateStatus, } from "./contract/transcript.mjs";
export { isPlainObject, makeError, } from "./contract/validation.mjs";
