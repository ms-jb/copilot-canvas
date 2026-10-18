// Authoritative transcript store for the host. Turns raw session events into the small,
// renderer-facing model (user / assistant / error entries plus a coarse status).
// Pure and synchronous so it can be unit-tested without the SDK.

import { ACTIVITY_LIMITS, LIMITS } from "./contract.mts";
import type {
  Activity,
  ActivityItem,
  SessionStatus,
  Snapshot,
  TranscriptEntry,
} from "./contract.mts";
import { createActivityTracker, isHiddenTool, oneLine } from "./activity.mts";
import { upsertEntry } from "./entries.mts";
import { transcriptAttachments } from "./contract/attachments.mts";

/** The subset of a session event this store reads. Real SDK events satisfy it structurally. */
export interface SessionEventLike {
  id?: string;
  type: string;
  timestamp: string;
  agentId?: string;
  data?: Record<string, any>;
}

export type TranscriptChange =
  | { type: "entry"; entry: TranscriptEntry }
  | { type: "status"; status: SessionStatus }
  | { type: "activity"; item: ActivityItem };

export interface TranscriptStore {
  /** Applies one event; replaying the same event id is a no-op. */
  applyEvent(event: SessionEventLike, options?: { history?: boolean }): TranscriptChange[];
  /** Applies recorded events oldest-first. Safe to call after the live subscription started. */
  mergeHistory(events: readonly SessionEventLike[]): TranscriptChange[];
  /** Records that composer request `requestId` was admitted as `messageId`. */
  tagRequest(messageId: string, requestId: string): TranscriptChange[];
  snapshot(): Snapshot;
}

const HIDDEN_USER_SOURCE_PREFIXES = ["skill-", "agent-", "system", "hook", "workflow", "autopilot"];
const SYSTEM_TAG = /^\s*<(system[_-]notification|system[_-]reminder)\b/i;
const MAX_SEEN_EVENTS = 5000;
const MAX_ERROR_TEXT = 2000;
const MAX_TOOL_NAME = 80;

/** True for a user.message that the person actually typed (not injected plumbing). */
export function isVisibleUserMessage(event: SessionEventLike | null | undefined): boolean {
  if (!event || event.agentId) return false;
  const data = event.data ?? {};
  if (typeof data.content !== "string") return false;
  if (data.content.trim().length === 0 && transcriptAttachments(data.attachments).length === 0)
    return false;
  if (data.isAutopilotContinuation === true) return false;
  if (typeof data.source === "string") {
    const source = data.source.toLowerCase();
    if (HIDDEN_USER_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix))) return false;
  }
  return !SYSTEM_TAG.test(data.content);
}

export function createTranscriptStore({
  maxEntries = LIMITS.maxEntries,
}: { maxEntries?: number } = {}): TranscriptStore {
  let entries: TranscriptEntry[] = [];
  let status: SessionStatus = { phase: "idle" };
  let statusLocked = false;
  const seenEvents = new Set<string>();
  const finalized = new Set<string>();
  const requestByMessage = new Map<string, string>();
  const activity = createActivityTracker();
  let intent: string | undefined;

  function markSeen(eventId: unknown): boolean {
    if (typeof eventId !== "string") return false;
    if (seenEvents.has(eventId)) return true;
    seenEvents.add(eventId);
    if (seenEvents.size > MAX_SEEN_EVENTS) {
      seenEvents.delete(seenEvents.values().next().value as string);
    }
    return false;
  }

  function putEntry(entry: TranscriptEntry): TranscriptChange {
    entries = upsertEntry(entries, entry, maxEntries);
    return { type: "entry", entry };
  }

  function setStatus(next: SessionStatus, history: boolean): TranscriptChange | null {
    if (history && statusLocked) return null;
    if (!history) statusLocked = true;
    if (
      status.phase === next.phase &&
      status.activity === next.activity &&
      status.toolName === next.toolName &&
      status.waitingFor === next.waitingFor &&
      status.intent === next.intent
    ) {
      return null;
    }
    status = next;
    return { type: "status", status: { ...next } };
  }

  /** A working status that keeps the turn's latest intent. */
  function working(kind: Activity, toolName?: string): SessionStatus {
    return {
      phase: "working",
      activity: kind,
      ...(toolName ? { toolName } : {}),
      ...(intent ? { intent } : {}),
    };
  }

  function applyEvent(
    event: SessionEventLike,
    { history = false }: { history?: boolean } = {},
  ): TranscriptChange[] {
    if (!event || typeof event.type !== "string") return [];
    if (event.agentId) return [];
    if (markSeen(event.id)) return [];
    const data = event.data ?? {};
    const changes: TranscriptChange[] = [];
    const push = (change: TranscriptChange | null) => {
      if (change) changes.push(change);
    };
    const pushActivity = (items: ActivityItem[]) => {
      for (const item of items) changes.push({ type: "activity", item: { ...item } });
    };
    pushActivity(activity.apply(event));

    switch (event.type) {
      case "user.message": {
        if (!isVisibleUserMessage(event)) break;
        const messageId = typeof data.messageId === "string" ? data.messageId : undefined;
        const attachments = transcriptAttachments(data.attachments);
        const entry: TranscriptEntry = {
          id: `user:${messageId ?? event.id}`,
          kind: "user",
          text: data.content,
          timestamp: event.timestamp,
          ...(attachments.length ? { attachments } : {}),
        };
        const requestId = messageId ? requestByMessage.get(messageId) : undefined;
        if (requestId) entry.requestId = requestId;
        push(putEntry(entry));
        activity.startTurn(event.timestamp);
        intent = undefined;
        push(setStatus(working("thinking"), history));
        break;
      }
      case "assistant.message_delta": {
        if (typeof data.messageId !== "string" || typeof data.deltaContent !== "string") break;
        const id = `assistant:${data.messageId}`;
        if (finalized.has(id)) break;
        const existing = entries.find((entry) => entry.id === id);
        push(
          putEntry({
            id,
            kind: "assistant",
            text: (existing?.text ?? "") + data.deltaContent,
            timestamp: existing?.timestamp ?? event.timestamp,
            streaming: true,
          }),
        );
        push(setStatus(working("responding"), history));
        break;
      }
      case "assistant.message": {
        if (typeof data.messageId !== "string") break;
        const id = `assistant:${data.messageId}`;
        const existing = entries.find((entry) => entry.id === id);
        finalized.add(id);
        const text = typeof data.content === "string" ? data.content : "";
        if (text.trim().length === 0) {
          // Tool-only message: keep any streamed text, otherwise render nothing.
          if (existing) push(putEntry({ ...existing, streaming: false }));
          break;
        }
        push(
          putEntry({
            id,
            kind: "assistant",
            text,
            timestamp: existing?.timestamp ?? event.timestamp,
            streaming: false,
          }),
        );
        break;
      }
      case "assistant.turn_start":
      case "assistant.reasoning_delta":
      case "tool.execution_complete":
        push(setStatus(working("thinking"), history));
        break;
      case "tool.execution_start": {
        if (isHiddenTool(data.toolName)) break;
        const toolName =
          typeof data.toolName === "string" ? data.toolName.slice(0, MAX_TOOL_NAME) : undefined;
        push(setStatus(working("tool", toolName), history));
        break;
      }
      case "assistant.intent": {
        intent = oneLine(data.intent, ACTIVITY_LIMITS.maxDetailChars);
        if (status.phase === "working") {
          push(setStatus(working(status.activity ?? "thinking", status.toolName), history));
        }
        break;
      }
      // assistant.idle ends the main agent's turn; session.idle waits for every background agent
      // and attached shell as well, so it may not come at all while background work runs.
      case "assistant.idle":
      case "session.idle":
      case "abort":
        intent = undefined;
        pushActivity(activity.endTurn());
        push(setStatus({ phase: "idle" }, history));
        break;
      case "permission.requested":
        if (data.resolvedByHook === true) break;
        push(setStatus({ phase: "waiting", waitingFor: "permission" }, history));
        break;
      case "user_input.requested":
        push(setStatus({ phase: "waiting", waitingFor: "input" }, history));
        break;
      case "elicitation.requested":
        push(setStatus({ phase: "waiting", waitingFor: "elicitation" }, history));
        break;
      case "exit_plan_mode.requested":
        push(setStatus({ phase: "waiting", waitingFor: "plan" }, history));
        break;
      case "permission.completed":
      case "user_input.completed":
      case "elicitation.completed":
      case "exit_plan_mode.completed":
        push(setStatus(working("thinking"), history));
        break;
      case "session.error": {
        const message =
          typeof data.message === "string" ? data.message : "The session reported an error.";
        push(
          putEntry({
            id: `error:${event.id ?? event.timestamp}`,
            kind: "error",
            text: message.slice(0, MAX_ERROR_TEXT),
            timestamp: event.timestamp,
          }),
        );
        break;
      }
      default:
        break;
    }
    return changes;
  }

  function mergeHistory(events: readonly SessionEventLike[]): TranscriptChange[] {
    const changes: TranscriptChange[] = [];
    for (const event of events) {
      changes.push(...applyEvent(event, { history: true }));
    }
    return changes;
  }

  function tagRequest(messageId: string, requestId: string): TranscriptChange[] {
    requestByMessage.set(messageId, requestId);
    if (requestByMessage.size > 200) {
      requestByMessage.delete(requestByMessage.keys().next().value as string);
    }
    const existing = entries.find((entry) => entry.id === `user:${messageId}`);
    if (!existing || existing.requestId === requestId) return [];
    return [putEntry({ ...existing, requestId })];
  }

  function snapshot(): Snapshot {
    return {
      entries: entries.map((entry) => ({ ...entry })),
      status: { ...status },
      activity: activity.items(),
    };
  }

  return { applyEvent, mergeHistory, tagRequest, snapshot };
}
