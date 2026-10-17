import { isPlainObject, type QueueState } from "../../shared/contract.mts";

export interface QueueRpcLike {
  pendingItems?: () => Promise<unknown>;
}

/** Reconcile only sends we admitted, never infer queue removal from an idle status alone. */
export function createQueueTracker(
  rpc: QueueRpcLike | undefined,
  notify: (state: QueueState) => void,
) {
  const pending = new Map<string, string>();
  const confirmed = new Set<string>();
  const removed = new Set<string>();
  let disposed = false;
  let reading = false;
  let dirty = false;
  const snapshot = (): QueueState => ({ removedRequestIds: [...removed] });
  const remember = (set: Set<string>, value: string) => {
    set.add(value);
    if (set.size > 500) set.delete(set.values().next().value!);
  };

  async function refresh() {
    if (disposed || typeof rpc?.pendingItems !== "function" || pending.size === 0) return;
    if (reading) {
      dirty = true;
      return;
    }
    reading = true;
    // A read that started before another send was admitted cannot remove that later send.
    const candidates = [...pending];
    try {
      const queue = await rpc.pendingItems();
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
        return;
      const held = new Set(queue.items.map((item) => item.messageId));
      let changed = false;
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
    } catch {
      // Experimental RPC failures leave pending messages visible; never invent a removal.
    } finally {
      reading = false;
      if (dirty && !disposed) {
        dirty = false;
        void refresh();
      }
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
    dispose() {
      disposed = true;
      pending.clear();
      confirmed.clear();
      removed.clear();
    },
  };
}
