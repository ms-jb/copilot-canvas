import { type PendingPrompt, validatePrompts } from "./prompts.mts";
import { isPlainObject } from "./validation.mts";
import { type ContextState, validateContextState } from "./context.mts";
import { type QueueState, validateQueueState } from "./queue.mts";
import {
  ATTACHMENT_LIMITS,
  type TranscriptAttachment,
  validateTranscriptAttachment,
} from "./attachments.mts";
import { ACTIVITY_LIMITS, type ActivityItem, validateActivity } from "./activity.mts";

export type EntryKind = "user" | "assistant" | "error";
export type Phase = "idle" | "working" | "waiting";
/** What the agent is doing while `phase` is "working". */
export type Activity = "thinking" | "responding" | "tool";
export type WaitingFor = "permission" | "input" | "elicitation" | "plan";

export interface TranscriptEntry {
  /** Stable id: `user:<messageId>`, `assistant:<messageId>` or `error:<eventId>`. */
  id: string;
  kind: EntryKind;
  text: string;
  timestamp: string;
  streaming?: boolean;
  /** Set on user entries once the host has matched the acknowledged messageId to a composer requestId. */
  requestId?: string;
  attachments?: TranscriptAttachment[];
}

export interface SessionStatus {
  phase: Phase;
  /** Only meaningful while phase is "working". */
  activity?: Activity;
  /** Tool name while activity is "tool" (display only, never arguments). */
  toolName?: string;
  waitingFor?: WaitingFor;
  /** The agent's latest reported intent while "working" (display only). */
  intent?: string;
}

export interface Snapshot {
  entries: TranscriptEntry[];
  status: SessionStatus;
  /** Requests the session is waiting on that can be answered from the canvas, oldest first. */
  prompts?: PendingPrompt[];
  queue?: QueueState;
  /** Context window usage; absent from providers that don't track it. */
  context?: ContextState;
  /** Thinking blocks and the current turn's tool calls, oldest first; absent from older hosts. */
  activity?: ActivityItem[];
}

export const PHASES: readonly Phase[] = Object.freeze(["idle", "working", "waiting"] as const);
export const ACTIVITIES: readonly Activity[] = Object.freeze([
  "thinking",
  "responding",
  "tool",
] as const);
export const WAITING_FOR: readonly WaitingFor[] = Object.freeze([
  "permission",
  "input",
  "elicitation",
  "plan",
] as const);
export const ENTRY_KINDS: readonly EntryKind[] = Object.freeze([
  "user",
  "assistant",
  "error",
] as const);

export function validateEntry(entry: unknown): entry is TranscriptEntry {
  if (!isPlainObject(entry)) return false;
  if (typeof entry.id !== "string" || entry.id.length === 0) return false;
  if (!ENTRY_KINDS.includes(entry.kind as EntryKind)) return false;
  if (typeof entry.text !== "string") return false;
  if (typeof entry.timestamp !== "string") return false;
  if (entry.streaming !== undefined && typeof entry.streaming !== "boolean") return false;
  if (entry.requestId !== undefined && typeof entry.requestId !== "string") return false;
  if (
    entry.attachments !== undefined &&
    (!Array.isArray(entry.attachments) ||
      entry.attachments.length > ATTACHMENT_LIMITS.maxCount ||
      !entry.attachments.every(validateTranscriptAttachment))
  )
    return false;
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
  if (
    status.intent !== undefined &&
    (typeof status.intent !== "string" || status.intent.length > ACTIVITY_LIMITS.maxDetailChars)
  ) {
    return false;
  }
  return true;
}

export function validateSnapshot(snapshot: unknown): snapshot is Snapshot {
  return (
    isPlainObject(snapshot) &&
    Array.isArray(snapshot.entries) &&
    snapshot.entries.every(validateEntry) &&
    validateStatus(snapshot.status) &&
    (snapshot.prompts === undefined || validatePrompts(snapshot.prompts)) &&
    (snapshot.queue === undefined || validateQueueState(snapshot.queue)) &&
    (snapshot.context === undefined || validateContextState(snapshot.context)) &&
    (snapshot.activity === undefined || validateActivity(snapshot.activity))
  );
}
