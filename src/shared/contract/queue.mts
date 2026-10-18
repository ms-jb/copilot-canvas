import { ERROR_CODES } from "./errors.mts";
import {
  isPlainObject,
  makeError,
  onlyKeys,
  SESSION_ID_PATTERN,
  type ValidationResult,
} from "./validation.mts";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_ID = /^[\w.:-]{1,128}$/;
export const QUEUE_LIMITS = Object.freeze({ maxItems: 200, maxTextChars: 2000 });

/** One message the session holds for its next turn; the host owns the list, pages only show it. */
export interface QueueItem {
  /** The session's stable queue id; the handle for edit, remove and move. */
  id: string;
  /** The composer request that queued it, when this host saw the send. */
  requestId?: string;
  kind: "message" | "command";
  /** Shown text, clipped to QUEUE_LIMITS.maxTextChars. */
  text: string;
  /** Clipped display text must not be saved back as if it were the complete message. */
  truncated?: boolean;
  /** When the message entered the queue, as far as the session or this host can tell. */
  queuedAt?: string;
}

export interface QueueState {
  /** Composer requests that the native queue no longer holds. No message content. */
  removedRequestIds: string[];
  /** The native queue in delivery order. Absent from hosts that predate it. */
  items?: QueueItem[];
}

export function validateQueueState(value: unknown): value is QueueState {
  return (
    isPlainObject(value) &&
    Array.isArray(value.removedRequestIds) &&
    value.removedRequestIds.length <= 500 &&
    value.removedRequestIds.every((id) => typeof id === "string" && REQUEST_ID.test(id)) &&
    (value.items === undefined ||
      (Array.isArray(value.items) &&
        value.items.length <= QUEUE_LIMITS.maxItems &&
        value.items.every(
          (item) =>
            isPlainObject(item) &&
            typeof item.id === "string" &&
            ITEM_ID.test(item.id) &&
            (item.requestId === undefined ||
              (typeof item.requestId === "string" && REQUEST_ID.test(item.requestId))) &&
            (item.kind === "message" || item.kind === "command") &&
            typeof item.text === "string" &&
            (item.truncated === undefined || typeof item.truncated === "boolean") &&
            item.text.length <= QUEUE_LIMITS.maxTextChars &&
            (item.queuedAt === undefined ||
              (typeof item.queuedAt === "string" && Number.isFinite(Date.parse(item.queuedAt)))),
        )))
  );
}

export type QueueChange =
  | { action: "remove"; id: string }
  | { action: "edit"; id: string; text: string }
  | { action: "move"; id: string; toPosition: number }
  | { action: "send_now"; id: string; requestId: string };

export interface QueuePayload {
  sessionId: string;
  change: QueueChange;
}

/** Validates POST api/queue: { sessionId, action, id, text? | toPosition? | requestId? }. */
export function validateQueuePayload(body: unknown): ValidationResult<QueuePayload> {
  if (
    !isPlainObject(body) ||
    !onlyKeys(body, ["sessionId", "action", "id", "text", "toPosition", "requestId"])
  ) {
    return makeError(ERROR_CODES.badRequest, "Body must be { sessionId, action, id }.");
  }
  const { sessionId, action, id, text, toPosition, requestId } = body;
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    return makeError(ERROR_CODES.badRequest, "sessionId is missing or malformed.");
  }
  if (typeof id !== "string" || !ITEM_ID.test(id)) {
    return makeError(ERROR_CODES.badRequest, "id is missing or malformed.");
  }
  if (action === "remove" && text === undefined && toPosition === undefined) {
    return { ok: true, value: { sessionId, change: { action, id } } };
  }
  if (action === "edit" && toPosition === undefined) {
    if (typeof text !== "string" || !text.trim() || text.length > QUEUE_LIMITS.maxTextChars) {
      return makeError(ERROR_CODES.badRequest, "text must be a non-empty string.");
    }
    return { ok: true, value: { sessionId, change: { action, id, text } } };
  }
  if (action === "move" && text === undefined) {
    if (
      !Number.isSafeInteger(toPosition) ||
      (toPosition as number) < 0 ||
      (toPosition as number) >= QUEUE_LIMITS.maxItems
    ) {
      return makeError(ERROR_CODES.badRequest, "toPosition must be a non-negative integer.");
    }
    return {
      ok: true,
      value: { sessionId, change: { action, id, toPosition: toPosition as number } },
    };
  }
  if (action === "send_now" && text === undefined && toPosition === undefined) {
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
      return makeError(ERROR_CODES.badRequest, "requestId is missing or malformed.");
    }
    return { ok: true, value: { sessionId, change: { action, id, requestId } } };
  }
  return makeError(ERROR_CODES.badRequest, "action must be remove, edit, move or send_now.");
}
