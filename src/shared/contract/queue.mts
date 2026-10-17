import { isPlainObject } from "./validation.mts";

export interface QueueState {
  /** Composer requests that the native queue no longer holds. No message content. */
  removedRequestIds: string[];
}

export function validateQueueState(value: unknown): value is QueueState {
  return (
    isPlainObject(value) &&
    Array.isArray(value.removedRequestIds) &&
    value.removedRequestIds.length <= 500 &&
    value.removedRequestIds.every(
      (id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id),
    )
  );
}
