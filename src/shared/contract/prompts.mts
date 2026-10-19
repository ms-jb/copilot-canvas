import { ERROR_CODES, type SendStatus } from "./errors.mts";
import { LIMITS } from "./limits.mts";
import {
  isOptionalString,
  isPlainObject,
  isString,
  isStringList,
  makeError,
  onlyKeys,
  SESSION_ID_PATTERN,
  type ValidationResult,
} from "./validation.mts";

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

const PROMPT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const FORM_FIELD_NAME_MAX = 128;

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
