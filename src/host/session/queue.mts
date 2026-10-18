import {
  isPlainObject,
  QUEUE_LIMITS,
  type QueueChange,
  type QueueItem,
  type QueueState,
} from "../../shared/contract.mts";
import { readWithTimeout } from "../read-timeout.mts";

export interface QueueRpcLike {
  pendingItems?: () => Promise<unknown>;
  removeAt?: (params: { id: string }) => Promise<unknown>;
  moveItem?: (params: { id: string; toPosition: number }) => Promise<unknown>;
  updateText?: (params: { id: string; prompt: string }) => Promise<unknown>;
}

export type QueueOutcome = "done" | "gone" | "unavailable" | "failed";

/** Reconcile only sends we admitted, never infer queue removal from an idle status alone. */
export function createQueueTracker(
  rpc: QueueRpcLike | undefined,
  notify: (state: QueueState) => void,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
) {
  const pending = new Map<string, string>();
  const confirmed = new Set<string>();
  const removed = new Set<string>();
  let items: QueueItem[] = [];
  let shown = "[]";
  let disposed = false;
  let reading: Promise<boolean> | undefined;
  let dirty = false;
  const snapshot = (): QueueState => ({ removedRequestIds: [...removed], items });
  const requestFor = (messageId: string) => [...pending].find(([, id]) => id === messageId)?.[0];
  const remember = (set: Set<string>, value: string) => {
    set.add(value);
    if (set.size > 500) set.delete(set.values().next().value!);
  };

  function refresh(): Promise<boolean> {
    if (disposed || typeof rpc?.pendingItems !== "function") return Promise.resolve(false);
    if (reading) {
      dirty = true;
      return reading;
    }
    return (reading = read());
  }

  async function read(): Promise<boolean> {
    if (typeof rpc?.pendingItems !== "function") return false;
    // A read that started before another send was admitted cannot remove that later send.
    const candidates = [...pending];
    try {
      const queue = await readWithTimeout(() => rpc.pendingItems!(), timeoutMs);
      if (
        disposed ||
        !isPlainObject(queue) ||
        !Array.isArray(queue.items) ||
        queue.items.length > 1000 ||
        !Array.isArray(queue.steeringMessages) ||
        !queue.steeringMessages.every((value) => typeof value === "string") ||
        (queue.withdrawableTurnMessageId !== undefined &&
          typeof queue.withdrawableTurnMessageId !== "string") ||
        !queue.items.every(
          (item) =>
            isPlainObject(item) &&
            ((item.kind === "message" &&
              typeof item.messageId === "string" &&
              item.messageId.length > 0) ||
              item.kind === "command"),
        )
      )
        return false;
      const held = new Set(queue.items.map((item) => item.messageId));
      // The page's request ids stay attached to items so every client can tell its own sends.
      const ids = new Set<string>();
      const next: QueueItem[] = queue.items
        .flatMap((item) => {
          if (typeof item.id !== "string" || !/^[\w.:-]{1,128}$/.test(item.id) || ids.has(item.id))
            return [];
          ids.add(item.id);
          const requestId =
            typeof item.messageId === "string" ? requestFor(item.messageId) : undefined;
          return [
            {
              id: item.id,
              ...(requestId ? { requestId } : {}),
              kind: item.kind as QueueItem["kind"],
              text:
                typeof item.displayText === "string"
                  ? item.displayText.slice(0, QUEUE_LIMITS.maxTextChars)
                  : "",
              ...(typeof item.displayText === "string" &&
              item.displayText.length > QUEUE_LIMITS.maxTextChars
                ? { truncated: true }
                : {}),
            },
          ];
        })
        .slice(0, QUEUE_LIMITS.maxItems);
      let changed = false;
      const key = JSON.stringify(next);
      if (key !== shown) {
        shown = key;
        items = next;
        changed = true;
      }
      for (const [requestId, messageId] of candidates) {
        if (
          pending.get(requestId) !== messageId ||
          confirmed.has(messageId) ||
          held.has(messageId) ||
          queue.withdrawableTurnMessageId === messageId
        )
          continue;
        pending.delete(requestId);
        remember(removed, requestId);
        changed = true;
      }
      if (changed) notify(snapshot());
      return true;
    } catch {
      // Experimental RPC failures leave pending messages visible; never invent a removal.
      return false;
    } finally {
      reading = undefined;
      if (dirty && !disposed) {
        dirty = false;
        void refresh();
      }
    }
  }

  let lock: Promise<unknown> = Promise.resolve();
  // A read already in flight may predate the caller's action, so wait it out and read again.
  async function freshRead() {
    await reading;
    if (!(await refresh())) throw new Error("Queue could not be refreshed.");
  }
  async function apply(change: QueueChange): Promise<QueueOutcome> {
    const method =
      change.action === "remove"
        ? rpc?.removeAt
        : change.action === "edit"
          ? rpc?.updateText
          : rpc?.moveItem;
    if (disposed || typeof method !== "function" || typeof rpc?.pendingItems !== "function")
      return "unavailable";
    try {
      await freshRead();
      if (disposed) return "unavailable";
      const item = items.find((item) => item.id === change.id);
      if (!item) return "gone";
      if (change.action === "edit" && (item.kind !== "message" || item.truncated))
        return "unavailable";
      const result: unknown = await readWithTimeout(
        () =>
          change.action === "remove"
            ? rpc.removeAt!({ id: change.id })
            : change.action === "edit"
              ? rpc.updateText!({ id: change.id, prompt: change.text })
              : rpc.moveItem!({ id: change.id, toPosition: change.toPosition }),
        timeoutMs,
      );
      await freshRead();
      if (change.action === "remove" && isPlainObject(result) && result.removed === false)
        return "gone";
      return "done";
    } catch {
      return "failed";
    }
  }

  return {
    snapshot,
    refresh,
    admitted(messageId: string, requestId: string) {
      if (disposed || confirmed.has(messageId)) return;
      pending.set(requestId, messageId);
      if (pending.size > 500) pending.delete(pending.keys().next().value!);
      void refresh();
    },
    confirmed(messageId: string) {
      remember(confirmed, messageId);
      for (const [requestId, id] of pending) if (id === messageId) pending.delete(requestId);
    },
    /** Mutations run one at a time against a fresh read, so two clients can't act on a stale list. */
    async change(change: QueueChange): Promise<QueueOutcome> {
      const run = lock.then(() => apply(change));
      lock = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    dispose() {
      disposed = true;
      pending.clear();
      confirmed.clear();
      removed.clear();
    },
  };
}
