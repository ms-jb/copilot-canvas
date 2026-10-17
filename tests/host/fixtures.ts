import type { SessionLike } from "../../extension-src/lib/bridge.mts";
import type { SessionEventLike } from "../../extension-src/shared/transcript.mts";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function fakeSession(rpc?: SessionLike["rpc"]) {
  const listeners = new Set<(event: SessionEventLike) => void>();
  return {
    sessionId: "session-1",
    rpc,
    on(listener: (event: SessionEventLike) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getEvents: async (): Promise<SessionEventLike[]> => [],
    send: async () => "message-1",
    emit(event: SessionEventLike) {
      for (const listener of listeners) listener(event);
    },
  };
}

export function promptEvent(type: string, requestId: string, data: Record<string, unknown> = {}) {
  return { type, timestamp: "2026-10-17T12:00:00Z", data: { requestId, ...data } };
}
