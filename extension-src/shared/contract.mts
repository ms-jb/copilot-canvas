// Shared wire contract between the extension host (provider), the renderer and the gateway.
// Pure TypeScript, no dependencies, safe to import from Node and from the browser bundle.

export const CONTRACT_VERSION = 2;
export const IDENTITY_APP = "copilot-canvas";

export type EntryKind = "user" | "assistant" | "error";
export type Phase = "idle" | "working" | "waiting";
/** What the agent is doing while `phase` is "working". */
export type Activity = "thinking" | "responding" | "tool";
export type WaitingFor = "permission" | "input" | "elicitation" | "plan";
export type SendStatus = "accepted" | "rejected" | "uncertain";
export type SessionMode = "interactive" | "plan" | "autopilot";
export type ContextTier = "default" | "long_context";

export interface TranscriptEntry {
  /** Stable id: `user:<messageId>`, `assistant:<messageId>` or `error:<eventId>`. */
  id: string;
  kind: EntryKind;
  text: string;
  timestamp: string;
  streaming?: boolean;
  /** Set on user entries once the host has matched the acknowledged messageId to a composer requestId. */
  requestId?: string;
}

export interface SessionStatus {
  phase: Phase;
  /** Only meaningful while phase is "working". */
  activity?: Activity;
  /** Tool name while activity is "tool" (display only, never arguments). */
  toolName?: string;
  waitingFor?: WaitingFor;
}

export interface Snapshot {
  entries: TranscriptEntry[];
  status: SessionStatus;
  /** Requests the session is waiting on that can be answered from the canvas, oldest first. */
  prompts?: PendingPrompt[];
}

export type PromptKind = "permission" | "question" | "form" | "plan";
/** What a permission request is for (display only). */
export type PermissionKind =
  | "command"
  | "write"
  | "read"
  | "path"
  | "url"
  | "mcp"
  | "tool"
  | "memory"
  | "extension"
  | "workflow"
  | "other";
export type PlanAction = "exit_only" | "interactive" | "autopilot" | "autopilot_fleet";
export type FormFieldType = "string" | "number" | "integer" | "boolean" | "enum";
export type FormValue = string | number | boolean;

/** One flat form field. Nested or multi-select fields are never offered in the canvas. */
export interface FormField {
  name: string;
  label: string;
  description?: string;
  type: FormFieldType;
  required: boolean;
  /** Choices for "enum" fields. */
  options?: { value: string; label: string }[];
  default?: FormValue;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

interface PromptBase {
  /** The session's own request id; answers are applied to exactly this request. */
  requestId: string;
  createdAt: string;
}

/** A tool permission request. The only decisions are "allow once" and "deny". */
export interface PermissionPrompt extends PromptBase {
  kind: "permission";
  permission: PermissionKind;
  /** Short name of what is asking (tool, server or extension), when known. */
  subject?: string;
  /** Why the agent wants it, in its own words. */
  intent?: string;
  /** The exact command, path, address or arguments being requested (bounded). */
  detail: string;
  /** A risk note supplied by the session. */
  warning?: string;
}

export interface QuestionPrompt extends PromptBase {
  kind: "question";
  question: string;
  choices: string[];
  allowFreeform: boolean;
}

export interface FormPrompt extends PromptBase {
  kind: "form";
  message: string;
  /** Name of the server that asked, when it was not the agent itself. */
  source?: string;
  fields: FormField[];
  /** False when the request needs something the canvas can't render; it can only be declined here. */
  supported: boolean;
}

export interface PlanPrompt extends PromptBase {
  kind: "plan";
  summary: string;
  /** Plan text as markdown (bounded). */
  plan: string;
  actions: PlanAction[];
  recommended?: PlanAction;
}

export type PendingPrompt = PermissionPrompt | QuestionPrompt | FormPrompt | PlanPrompt;

/** The user's explicit answer to one pending prompt. */
export type PromptResponse =
  | { kind: "permission"; decision: "approve" | "deny" }
  | { kind: "question"; answer: string; freeform: boolean }
  | { kind: "form"; action: "accept" | "decline" | "cancel"; values?: Record<string, FormValue> }
  | { kind: "plan"; approved: true; action: PlanAction }
  | { kind: "plan"; approved: false; feedback?: string };

export interface RespondPayload {
  sessionId: string;
  requestId: string;
  response: PromptResponse;
}

export interface RespondResult {
  ok: boolean;
  status: SendStatus;
  code?: string;
  message?: string;
}

/** A model the session can switch to, as reported by the native model list. */
export interface ModelOption {
  id: string;
  name: string;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  contextTiers?: ContextTier[];
}

/**
 * Native session settings. Each control is present in `available` only when the host
 * verified the native API exists; the renderer hides controls that are not available.
 */
export interface SessionControls {
  available: { mode: boolean; model: boolean; reasoningEffort: boolean; contextTier: boolean };
  mode?: SessionMode;
  modelId?: string;
  reasoningEffort?: string;
  contextTier?: ContextTier;
  models: ModelOption[];
}

/** Exactly one key is set per change request. */
export type ControlChange =
  | { mode: SessionMode }
  | { modelId: string }
  | { reasoningEffort: string }
  | { contextTier: ContextTier };

export interface ControlsPayload {
  sessionId: string;
  change: ControlChange;
}

export interface PanelConfig {
  /** Name shown in the UI and as the canvas title. */
  assistantName: string;
  description?: string;
  defaultView: string;
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

export interface SendPayload {
  requestId: string;
  sessionId: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  status: SendStatus;
  requestId?: string;
  messageId?: string;
  code?: string;
  message?: string;
}

export type ServerEvent =
  | {
      name: "snapshot";
      data: { seq: number; generation: string; snapshot: Snapshot; controls: SessionControls };
    }
  | { name: "entry"; data: { seq: number; entry: TranscriptEntry } }
  | { name: "status"; data: { seq: number; status: SessionStatus } }
  | { name: "controls"; data: { seq: number; controls: SessionControls } }
  | { name: "prompts"; data: { seq: number; prompts: PendingPrompt[] } };

export type ValidationFailure = { ok: false; code: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

// Paths are relative to the provider's capability prefix (or to the gateway root).
export const API = Object.freeze({
  identity: "api/identity",
  bootstrap: "api/bootstrap",
  events: "api/events",
  send: "api/send",
  controls: "api/controls",
  share: "api/share",
  respond: "api/respond",
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
  /** Answering a prompt must stay well under the gateway's upstream timeout. */
  respondTimeoutMs: 20000,
  maxPrompts: 20,
  maxAnswerChars: 4000,
  maxPromptDetailChars: 4000,
  maxPlanChars: 20000,
  maxChoices: 20,
  maxFormFields: 20,
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
  controlUnavailable: "control_unavailable",
  controlFailed: "control_failed",
  notConnected: "not_connected",
  internal: "internal_error",
  /** The prompt was already answered (here or in another client) or is no longer waiting. */
  promptResolved: "prompt_resolved",
  promptUnavailable: "prompt_unavailable",
  respondFailed: "respond_failed",
  respondUncertain: "respond_uncertain",
});

export const HTTP_STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
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
  [ERROR_CODES.controlUnavailable]: 501,
  [ERROR_CODES.controlFailed]: 502,
  [ERROR_CODES.notConnected]: 503,
  [ERROR_CODES.internal]: 500,
  [ERROR_CODES.promptResolved]: 409,
  [ERROR_CODES.promptUnavailable]: 501,
  [ERROR_CODES.respondFailed]: 502,
  [ERROR_CODES.respondUncertain]: 504,
});

// Outcome of a send attempt as reported to the renderer.
export const SEND_STATUS = Object.freeze({
  accepted: "accepted",
  rejected: "rejected",
  uncertain: "uncertain",
} as const);

export const SSE_EVENTS = Object.freeze({
  snapshot: "snapshot",
  entry: "entry",
  status: "status",
  controls: "controls",
  prompts: "prompts",
} as const);

export const PHASES: readonly Phase[] = Object.freeze(["idle", "working", "waiting"] as const);
export const ACTIVITIES: readonly Activity[] = Object.freeze([
  "thinking",
  "responding",
  "tool",
] as const);
export const SESSION_MODES: readonly SessionMode[] = Object.freeze([
  "interactive",
  "plan",
  "autopilot",
] as const);
export const CONTEXT_TIERS: readonly ContextTier[] = Object.freeze([
  "default",
  "long_context",
] as const);
export const WAITING_FOR: readonly WaitingFor[] = Object.freeze([
  "permission",
  "input",
  "elicitation",
  "plan",
] as const);
export const PLAN_ACTIONS: readonly PlanAction[] = Object.freeze([
  "exit_only",
  "interactive",
  "autopilot",
  "autopilot_fleet",
] as const);
const PROMPT_KINDS: readonly PromptKind[] = ["permission", "question", "form", "plan"];
const PERMISSION_KINDS: readonly PermissionKind[] = [
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
const FORM_FIELD_TYPES: readonly FormFieldType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "enum",
];
export const ENTRY_KINDS: readonly EntryKind[] = Object.freeze([
  "user",
  "assistant",
  "error",
] as const);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function makeError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ValidationFailure & Record<string, unknown> {
  return { ok: false, code, message, ...extra };
}

/**
 * Validates the body of POST api/send. Accepts exactly { requestId, sessionId, text };
 * unknown keys are rejected.
 */
export function validateSendPayload(body: unknown): ValidationResult<SendPayload> {
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
    return makeError(
      ERROR_CODES.payloadTooLarge,
      `text exceeds ${LIMITS.maxPromptChars} characters.`,
    );
  }
  return { ok: true, value: { requestId, sessionId, text } };
}

export function validateEntry(entry: unknown): entry is TranscriptEntry {
  if (!isPlainObject(entry)) return false;
  if (typeof entry.id !== "string" || entry.id.length === 0) return false;
  if (!ENTRY_KINDS.includes(entry.kind as EntryKind)) return false;
  if (typeof entry.text !== "string") return false;
  if (typeof entry.timestamp !== "string") return false;
  if (entry.streaming !== undefined && typeof entry.streaming !== "boolean") return false;
  if (entry.requestId !== undefined && typeof entry.requestId !== "string") return false;
  return true;
}

export function validateStatus(status: unknown): status is SessionStatus {
  if (!isPlainObject(status)) return false;
  if (!PHASES.includes(status.phase as Phase)) return false;
  if (status.activity !== undefined && !ACTIVITIES.includes(status.activity as Activity)) {
    return false;
  }
  if (status.toolName !== undefined && typeof status.toolName !== "string") return false;
  if (status.waitingFor !== undefined && !WAITING_FOR.includes(status.waitingFor as WaitingFor)) {
    return false;
  }
  return true;
}

export function validateControls(controls: unknown): controls is SessionControls {
  return (
    isPlainObject(controls) &&
    isPlainObject(controls.available) &&
    Array.isArray(controls.models) &&
    (controls.mode === undefined || SESSION_MODES.includes(controls.mode as SessionMode))
  );
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;

/** Validates the body of POST api/controls: { sessionId, change } with exactly one change key. */
export function validateControlsPayload(body: unknown): ValidationResult<ControlsPayload> {
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
  const value = change[keys[0]!];
  switch (keys[0]) {
    case "mode":
      if (SESSION_MODES.includes(value as SessionMode)) {
        return { ok: true, value: { sessionId, change: { mode: value as SessionMode } } };
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
      if (CONTEXT_TIERS.includes(value as ContextTier)) {
        return { ok: true, value: { sessionId, change: { contextTier: value as ContextTier } } };
      }
      break;
  }
  return makeError(ERROR_CODES.badRequest, "Unsupported or malformed change.");
}

export function validateSnapshot(snapshot: unknown): snapshot is Snapshot {
  return (
    isPlainObject(snapshot) &&
    Array.isArray(snapshot.entries) &&
    snapshot.entries.every(validateEntry) &&
    validateStatus(snapshot.status) &&
    (snapshot.prompts === undefined || validatePrompts(snapshot.prompts))
  );
}

const PROMPT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const FORM_FIELD_NAME_MAX = 128;

const isString = (value: unknown): value is string => typeof value === "string";
const isOptionalString = (value: unknown) => value === undefined || typeof value === "string";
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

function validateFormField(field: unknown): field is FormField {
  if (!isPlainObject(field)) return false;
  if (!isString(field.name) || !isString(field.label)) return false;
  if (!FORM_FIELD_TYPES.includes(field.type as FormFieldType)) return false;
  if (typeof field.required !== "boolean" || !isOptionalString(field.description)) return false;
  if (field.options !== undefined) {
    if (!Array.isArray(field.options)) return false;
    if (!field.options.every((o) => isPlainObject(o) && isString(o.value) && isString(o.label))) {
      return false;
    }
  }
  return true;
}

/** Structural check of one pending prompt as sent to the renderer. */
export function validatePrompt(prompt: unknown): prompt is PendingPrompt {
  if (!isPlainObject(prompt)) return false;
  if (!PROMPT_KINDS.includes(prompt.kind as PromptKind)) return false;
  if (!isString(prompt.requestId) || !PROMPT_REQUEST_ID_PATTERN.test(prompt.requestId)) {
    return false;
  }
  if (!isString(prompt.createdAt)) return false;
  switch (prompt.kind) {
    case "permission":
      return (
        PERMISSION_KINDS.includes(prompt.permission as PermissionKind) &&
        isString(prompt.detail) &&
        isOptionalString(prompt.subject) &&
        isOptionalString(prompt.intent) &&
        isOptionalString(prompt.warning)
      );
    case "question":
      return (
        isString(prompt.question) &&
        isStringList(prompt.choices) &&
        typeof prompt.allowFreeform === "boolean"
      );
    case "form":
      return (
        isString(prompt.message) &&
        isOptionalString(prompt.source) &&
        typeof prompt.supported === "boolean" &&
        Array.isArray(prompt.fields) &&
        prompt.fields.every(validateFormField)
      );
    default:
      return (
        isString(prompt.summary) &&
        isString(prompt.plan) &&
        Array.isArray(prompt.actions) &&
        prompt.actions.every((action) => PLAN_ACTIONS.includes(action as PlanAction)) &&
        (prompt.recommended === undefined ||
          PLAN_ACTIONS.includes(prompt.recommended as PlanAction))
      );
  }
}

export function validatePrompts(prompts: unknown): prompts is PendingPrompt[] {
  return Array.isArray(prompts) && prompts.every(validatePrompt);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validateAnswerText(value: unknown, allowEmpty = false): value is string {
  return (
    isString(value) &&
    value.length <= LIMITS.maxAnswerChars &&
    (allowEmpty || value.trim().length > 0)
  );
}

function validatePromptResponse(response: unknown): PromptResponse | null {
  if (!isPlainObject(response)) return null;
  switch (response.kind) {
    case "permission":
      if (!onlyKeys(response, ["kind", "decision"])) return null;
      return response.decision === "approve" || response.decision === "deny"
        ? { kind: "permission", decision: response.decision }
        : null;
    case "question":
      if (!onlyKeys(response, ["kind", "answer", "freeform"])) return null;
      if (!validateAnswerText(response.answer) || typeof response.freeform !== "boolean") {
        return null;
      }
      return { kind: "question", answer: response.answer, freeform: response.freeform };
    case "form": {
      if (!onlyKeys(response, ["kind", "action", "values"])) return null;
      const { action, values } = response;
      if (action !== "accept" && action !== "decline" && action !== "cancel") return null;
      if (values === undefined) return { kind: "form", action };
      if (action !== "accept" || !isPlainObject(values)) return null;
      const entries = Object.entries(values);
      if (entries.length > LIMITS.maxFormFields) return null;
      const clean: Record<string, FormValue> = {};
      for (const [name, value] of entries) {
        if (name.length === 0 || name.length > FORM_FIELD_NAME_MAX) return null;
        const ok =
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          validateAnswerText(value, true);
        if (!ok) return null;
        Object.defineProperty(clean, name, { value, enumerable: true, writable: true });
      }
      return { kind: "form", action, values: clean };
    }
    case "plan":
      if (!onlyKeys(response, ["kind", "approved", "action", "feedback"])) return null;
      if (response.approved === true) {
        if (response.feedback !== undefined) return null;
        return PLAN_ACTIONS.includes(response.action as PlanAction)
          ? { kind: "plan", approved: true, action: response.action as PlanAction }
          : null;
      }
      if (response.approved !== false || response.action !== undefined) return null;
      if (response.feedback === undefined) return { kind: "plan", approved: false };
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
export function validateRespondPayload(body: unknown): ValidationResult<RespondPayload> {
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
  if (!response) return makeError(ERROR_CODES.badRequest, "Unsupported or malformed response.");
  return { ok: true, value: { sessionId, requestId, response } };
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
