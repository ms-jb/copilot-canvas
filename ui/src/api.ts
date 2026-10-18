// Stable browser API facade. Transport and feature-specific outcomes live in connection/.
export { ApiError, getJson, postJson } from "./connection/http";
export type { ApiErrorKind, SendContext } from "./connection/http";
export { fetchBootstrap, fetchIdentity } from "./connection/bootstrap";
export { fetchSessions } from "./connection/sessions";
export {
  makeRequestId,
  sendMessage,
  requestReload,
  requestStop,
} from "./connection/session-actions";
export type { SendOutcome, ReloadOutcome, StopOutcome } from "./connection/session-actions";
export { respondToPrompt } from "./connection/prompt-actions";
export type { RespondOutcome } from "./connection/prompt-actions";
export { requestQueueChange } from "./connection/queue-actions";
export { fetchContextUsage, fetchSkills } from "./connection/composer-actions";
