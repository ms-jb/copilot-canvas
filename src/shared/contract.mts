// Shared wire contract between the extension host (provider), the renderer and the gateway.
// Pure TypeScript, no dependencies, safe to import from Node and from the browser bundle.
// Keep this compatibility entry point explicit; domain modules own their types and validators.
// Domain modules import each other directly, never this facade.

export {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_LIMITS,
  attachmentByteLength,
  isAttachmentMimeType,
  isSafeAttachmentName,
  transcriptAttachments,
  validateAttachments,
  type AttachmentMimeType,
  type SendAttachment,
  type TranscriptAttachment,
} from "./contract/attachments.mts";
export {
  CONTEXT_TIERS,
  SESSION_MODES,
  type ContextTier,
  type ControlChange,
  type ControlsPayload,
  type ModelOption,
  type SessionControls,
  type SessionMode,
  validateControls,
  validateControlsPayload,
} from "./contract/controls.mts";
export {
  ERROR_CODES,
  HTTP_STATUS_BY_CODE,
  SEND_STATUS,
  type SendStatus,
} from "./contract/errors.mts";
export { LIMITS } from "./contract/limits.mts";
export type { QueueState } from "./contract/queue.mts";
export {
  APP_SESSION_ID,
  MAX_SESSIONS,
  validateSessions,
  type SessionActivity,
  type SessionsInfo,
  type SessionSummary,
} from "./contract/sessions.mts";
export {
  PLAN_ACTIONS,
  type FormField,
  type FormFieldType,
  type FormPrompt,
  type FormValue,
  type PendingPrompt,
  type PermissionKind,
  type PermissionPrompt,
  type PlanAction,
  type PlanPrompt,
  type PromptKind,
  type PromptResponse,
  type QuestionPrompt,
  type RespondPayload,
  type RespondResult,
  validatePrompt,
  validatePrompts,
  validateRespondPayload,
} from "./contract/prompts.mts";
export {
  API,
  CONTRACT_VERSION,
  HEADERS,
  IDENTITY_APP,
  SSE_EVENTS,
  type Bootstrap,
  type Identity,
  type PanelConfig,
  type ReloadPayload,
  type SendPayload,
  type SendMode,
  type SendResult,
  type ServerEvent,
  type ShareInfo,
  toPublicOrigin,
  validateBootstrap,
  validateIdentity,
  validateReloadPayload,
  validateSendPayload,
  validateServerEvent,
} from "./contract/protocol.mts";
export {
  ACTIVITIES,
  ENTRY_KINDS,
  PHASES,
  WAITING_FOR,
  type Activity,
  type EntryKind,
  type Phase,
  type SessionStatus,
  type Snapshot,
  type TranscriptEntry,
  type WaitingFor,
  validateEntry,
  validateSnapshot,
  validateStatus,
} from "./contract/transcript.mts";
export {
  isPlainObject,
  makeError,
  type ValidationFailure,
  type ValidationResult,
} from "./contract/validation.mts";
