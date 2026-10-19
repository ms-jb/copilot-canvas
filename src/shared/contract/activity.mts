// Live activity shown in the transcript while the agent works: its thinking and its tool calls.
// The host summarizes, redacts and truncates everything before it reaches the wire.

import { isPlainObject } from "./validation.mts";

export const ACTIVITY_LIMITS = Object.freeze({
  /** Thinking blocks kept across turns (the newest win). */
  maxReasoning: 10,
  /** Tool calls kept for the current turn (the newest win). */
  maxTools: 30,
  maxReasoningChars: 6000,
  maxArgsChars: 1200,
  maxResultChars: 2000,
  maxNameChars: 80,
  maxDetailChars: 160,
  maxProgressChars: 240,
});

export type ToolState = "running" | "succeeded" | "failed";
export const TOOL_STATES: readonly ToolState[] = Object.freeze([
  "running",
  "succeeded",
  "failed",
] as const);

export interface ReasoningItem {
  /** `reasoning:<reasoningId>` */
  id: string;
  kind: "reasoning";
  text: string;
  timestamp: string;
  streaming?: boolean;
  /** The text was cut at `maxReasoningChars`. */
  truncated?: boolean;
}

export interface ToolItem {
  /** `tool:<toolCallId>` */
  id: string;
  kind: "tool";
  name: string;
  /** A friendlier title: the tool's display title or the sub-agent it started. */
  title?: string;
  /** What the call is for: its description argument, or the path, command or host it targets. */
  detail?: string;
  state: ToolState;
  /** When the call started. */
  timestamp: string;
  durationMs?: number;
  /** Redacted, truncated arguments summary. */
  args?: string;
  /** Redacted, truncated result or error summary. */
  result?: string;
  progress?: string;
}

export type ActivityItem = ReasoningItem | ToolItem;

const optionalString = (value: unknown, max: number) =>
  value === undefined || (typeof value === "string" && value.length <= max);

export function validateActivityItem(item: unknown): item is ActivityItem {
  if (!isPlainObject(item)) return false;
  if (typeof item.id !== "string" || item.id.length === 0) return false;
  if (typeof item.timestamp !== "string") return false;
  if (item.kind === "reasoning") {
    return (
      typeof item.text === "string" &&
      item.text.length <= ACTIVITY_LIMITS.maxReasoningChars &&
      (item.streaming === undefined || typeof item.streaming === "boolean") &&
      (item.truncated === undefined || typeof item.truncated === "boolean")
    );
  }
  if (item.kind !== "tool") return false;
  return (
    typeof item.name === "string" &&
    item.name.length <= ACTIVITY_LIMITS.maxNameChars &&
    TOOL_STATES.includes(item.state as ToolState) &&
    optionalString(item.title, ACTIVITY_LIMITS.maxNameChars) &&
    optionalString(item.detail, ACTIVITY_LIMITS.maxDetailChars) &&
    optionalString(item.args, ACTIVITY_LIMITS.maxArgsChars) &&
    optionalString(item.result, ACTIVITY_LIMITS.maxResultChars) &&
    optionalString(item.progress, ACTIVITY_LIMITS.maxProgressChars) &&
    (item.durationMs === undefined ||
      (typeof item.durationMs === "number" &&
        Number.isFinite(item.durationMs) &&
        item.durationMs >= 0))
  );
}

export function validateActivity(items: unknown): items is ActivityItem[] {
  return (
    Array.isArray(items) &&
    items.length <= ACTIVITY_LIMITS.maxReasoning + ACTIVITY_LIMITS.maxTools &&
    items.every(validateActivityItem)
  );
}

/**
 * Keeps the newest thinking blocks and only the newest tool calls since `since` (the latest user
 * message), in time order. The host and the renderer both apply it, so they agree on what is kept.
 */
export function pruneActivity(items: readonly ActivityItem[], since?: string): ActivityItem[] {
  const tools = items
    .filter((item) => item.kind === "tool" && (since === undefined || item.timestamp >= since))
    .slice(-ACTIVITY_LIMITS.maxTools);
  const reasoning = items
    .filter((item) => item.kind === "reasoning")
    .slice(-ACTIVITY_LIMITS.maxReasoning);
  const kept = new Set([...tools, ...reasoning]);
  return items.filter((item) => kept.has(item));
}
