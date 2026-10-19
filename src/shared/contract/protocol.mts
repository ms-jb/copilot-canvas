import { type SessionControls, validateControls } from "./controls.mts";
import { type SendAttachment, validateAttachments } from "./attachments.mts";
import { ERROR_CODES, type SendStatus } from "./errors.mts";
import { LIMITS } from "./limits.mts";
import { type PendingPrompt, validatePrompts } from "./prompts.mts";
import { type QueueState, validateQueueState } from "./queue.mts";
import { type ContextState, validateContextState } from "./context.mts";
import { type ActivityItem, validateActivityItem } from "./activity.mts";
import {
  type SessionStatus,
  type Snapshot,
  type TranscriptEntry,
  validateEntry,
  validateSnapshot,
  validateStatus,
} from "./transcript.mts";
import {
  isPlainObject,
  makeError,
  SESSION_ID_PATTERN,
  type ValidationResult,
} from "./validation.mts";

export const CONTRACT_VERSION = 2;
export const IDENTITY_APP = "copilot-companion";

export interface PanelConfig {
  /** Name shown in the UI and as the canvas title. */
  assistantName: string;
  description?: string;
  defaultView: string;
  /** The clone `npm run install-ext` installed from, when known. A hint: it can be stale or absent. */
  sourceDir?: string;
}

export interface Bootstrap {
  contractVersion: number;
  generation: string;
  sessionId: string;
  csrfToken: string;
  config: PanelConfig;
  snapshot: Snapshot;
  controls: SessionControls;
}

/** GET api/share: the public root origin (no path, no token) for "Open on phone", if configured. */
export interface ShareInfo {
  publicUrl: string | null;
}

export interface Identity {
  app: string;
  contractVersion: number;
  generation: string;
}

export interface ReloadPayload {
  sessionId: string;
}

export type SendMode = "immediate" | "enqueue";

export interface SendPayload {
  requestId: string;
  sessionId: string;
  text: string;
  attachments?: SendAttachment[];
  mode: SendMode;
}

export interface SendResult {
  ok: boolean;
  status: SendStatus;
  requestId?: string;
  messageId?: string;
  code?: string;
  message?: string;
}

export interface AppendData {
  seq: number;
  target: "entry" | "activity";
  id: string;
  text: string;
}

export type ServerEvent =
  | {
      name: "snapshot";
      data: { seq: number; generation: string; snapshot: Snapshot; controls: SessionControls };
    }
  | { name: "entry"; data: { seq: number; entry: TranscriptEntry } }
  | { name: "status"; data: { seq: number; status: SessionStatus } }
  | { name: "controls"; data: { seq: number; controls: SessionControls } }
  | { name: "queue"; data: { seq: number; queue: QueueState } }
  | { name: "context"; data: { seq: number; context: ContextState } }
  | { name: "activity"; data: { seq: number; item: ActivityItem } }
  | { name: "append"; data: AppendData }
  | { name: "prompts"; data: { seq: number; prompts: PendingPrompt[] } };

// Paths are relative to the provider's capability prefix (or to the gateway root).
export const API = Object.freeze({
  identity: "api/identity",
  bootstrap: "api/bootstrap",
  events: "api/events",
  send: "api/send",
  controls: "api/controls",
  share: "api/share",
  sessions: "api/sessions",
  respond: "api/respond",
  reload: "api/reload",
  stop: "api/stop",
  queue: "api/queue",
  skills: "api/skills",
  context: "api/context",
  // Served by the gateway itself (phone only), never forwarded to the provider.
  pushKey: "api/push/key",
  pushSubscribe: "api/push/subscribe",
  pushUnsubscribe: "api/push/unsubscribe",
  pushTest: "api/push/test",
  /** POST endpoint active-hours settings for this device's subscription. */
  pushSettings: "api/push/settings",
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
  queue: "queue",
  context: "context",
  activity: "activity",
  append: "append",
} as const);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Validates POST api/send: { requestId, sessionId, text, attachments?, mode? };
 * unknown keys are rejected.
 */
export function validateSendPayload(body: unknown): ValidationResult<SendPayload> {
  if (!isPlainObject(body)) {
    return makeError(ERROR_CODES.badRequest, "Body must be a JSON object.");
  }
  const allowed = new Set(["requestId", "sessionId", "text", "attachments", "mode"]);
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
  const mode = body.mode === undefined ? "immediate" : body.mode;
  if (mode !== "immediate" && mode !== "enqueue") {
    return makeError(ERROR_CODES.badRequest, "mode must be immediate or enqueue.");
  }
  const parsedAttachments = validateAttachments(body.attachments ?? []);
  if (body.attachments === null || !parsedAttachments.ok) {
    return parsedAttachments.ok
      ? makeError(ERROR_CODES.badRequest, "attachments must be an array.")
      : parsedAttachments;
  }
  if (text.trim().length === 0 && parsedAttachments.value.length === 0) {
    return makeError(ERROR_CODES.badRequest, "Add text or an attachment.");
  }
  if (text.length > LIMITS.maxPromptChars) {
    return makeError(
      ERROR_CODES.payloadTooLarge,
      `text exceeds ${LIMITS.maxPromptChars} characters.`,
    );
  }
  return {
    ok: true,
    value: {
      requestId,
      sessionId,
      text,
      mode,
      ...(body.attachments === undefined ? {} : { attachments: parsedAttachments.value }),
    },
  };
}

/** Validates the body of POST api/reload or api/stop: { sessionId }. */
export function validateReloadPayload(body: unknown): ValidationResult<ReloadPayload> {
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
export function validateServerEvent(name: string, data: unknown): boolean {
  if (!isPlainObject(data) || !Number.isInteger(data.seq) || (data.seq as number) < 0) return false;
  switch (name) {
    case SSE_EVENTS.snapshot:
      return (
        typeof data.generation === "string" &&
        validateSnapshot(data.snapshot) &&
        validateControls(data.controls)
      );
    case SSE_EVENTS.entry:
      return validateEntry(data.entry);
    case SSE_EVENTS.status:
      return validateStatus(data.status);
    case SSE_EVENTS.controls:
      return validateControls(data.controls);
    case SSE_EVENTS.prompts:
      return validatePrompts(data.prompts);
    case SSE_EVENTS.queue:
      return validateQueueState(data.queue);
    case SSE_EVENTS.context:
      return validateContextState(data.context);
    case SSE_EVENTS.activity:
      return validateActivityItem(data.item);
    case SSE_EVENTS.append:
      return (
        (data.target === "entry" || data.target === "activity") &&
        typeof data.id === "string" &&
        data.id.length > 0 &&
        typeof data.text === "string"
      );
    default:
      return false;
  }
}

/** Validates the body of GET api/bootstrap. */
export function validateBootstrap(body: unknown): body is Bootstrap {
  return (
    isPlainObject(body) &&
    body.contractVersion === CONTRACT_VERSION &&
    typeof body.generation === "string" &&
    typeof body.sessionId === "string" &&
    typeof body.csrfToken === "string" &&
    isPlainObject(body.config) &&
    typeof body.config.assistantName === "string" &&
    (body.config.sourceDir === undefined || typeof body.config.sourceDir === "string") &&
    validateSnapshot(body.snapshot) &&
    validateControls(body.controls)
  );
}

/** Returns only the scheme://host[:port] of an http(s) URL, or null. Never keeps a path or query. */
export function toPublicOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Validates the body of GET api/identity (no CSRF token, no transcript data). */
export function validateIdentity(body: unknown): body is Identity {
  return (
    isPlainObject(body) &&
    body.app === IDENTITY_APP &&
    body.contractVersion === CONTRACT_VERSION &&
    typeof body.generation === "string"
  );
}
