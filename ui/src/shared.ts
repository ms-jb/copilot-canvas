// Single place where the renderer imports the shared wire contract, so the relative path to
// `extension-src/shared` lives in one file.
export {
  API,
  ERROR_CODES,
  HEADERS,
  LIMITS,
  validateBootstrap,
  validateIdentity,
  validateServerEvent,
} from "../../extension-src/shared/contract.mts";
export type {
  Bootstrap,
  Identity,
  PanelConfig,
  SendPayload,
  ServerEvent,
  SessionStatus,
  TranscriptEntry,
} from "../../extension-src/shared/contract.mts";
export {
  applyServerEvent,
  createViewState,
  resolvePending,
} from "../../extension-src/shared/entries.mts";
export type { ViewState } from "../../extension-src/shared/entries.mts";
