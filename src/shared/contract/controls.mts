import { ERROR_CODES } from "./errors.mts";
import {
  isPlainObject,
  makeError,
  SESSION_ID_PATTERN,
  type ValidationResult,
} from "./validation.mts";

export type SessionMode = "interactive" | "plan" | "autopilot";
export type ContextTier = "default" | "long_context";

/** A model the session can switch to, as reported by the native model list. */
export interface ModelOption {
  id: string;
  name: string;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  contextTiers?: ContextTier[];
  /** Prompt token budget per context tier, when the catalog publishes it. */
  contextTokens?: Partial<Record<ContextTier, number>>;
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

export const SESSION_MODES: readonly SessionMode[] = Object.freeze([
  "interactive",
  "plan",
  "autopilot",
] as const);
export const CONTEXT_TIERS: readonly ContextTier[] = Object.freeze([
  "default",
  "long_context",
] as const);

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;

export function validateControls(controls: unknown): controls is SessionControls {
  return (
    isPlainObject(controls) &&
    isPlainObject(controls.available) &&
    Array.isArray(controls.models) &&
    (controls.mode === undefined || SESSION_MODES.includes(controls.mode as SessionMode))
  );
}

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
