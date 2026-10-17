// Session bridge: connects one joined Copilot session to the provider server.
//
// - Subscribes to live session events BEFORE reading history, then merges history (the
//   transcript store de-duplicates by event id, so the overlap is harmless).
// - Turns store changes into sequence-numbered change events for subscribers.
// - Coalesces streaming entry updates (~50ms) so SSE clients are not flooded.
// - Sends composer text through the joined session (never sendAndWait) with a timeout that
//   reports "uncertain" instead of ever re-sending.
// - Never answers permission or question events; it only mirrors them as a "waiting" status.

import { ERROR_CODES, LIMITS, SEND_STATUS } from "../shared/contract.mts";
import type { SessionStatus, Snapshot, TranscriptEntry } from "../shared/contract.mts";
import { createTranscriptStore } from "../shared/transcript.mts";
import type { SessionEventLike, TranscriptChange, TranscriptStore } from "../shared/transcript.mts";

const DEFAULT_COALESCE_MS = 50;
const MAX_TRACKED_REQUESTS = 500;
const MAX_ERROR_MESSAGE = 300;

/** The slice of the SDK session the bridge uses. Tests can pass a fake. */
export interface SessionLike {
  sessionId: string;
  on(handler: (event: SessionEventLike) => void): () => void;
  getEvents(): Promise<readonly SessionEventLike[]>;
  send(options: { prompt: string }): Promise<string>;
}

export type LogLevel = "info" | "warning" | "error";
export type Logger = (message: string, level?: LogLevel) => void;

export type BridgeEvent =
  | { seq: number; type: "entry"; entry: TranscriptEntry }
  | { seq: number; type: "status"; status: SessionStatus };

export type SendOutcome =
  | { ok: true; status: "accepted"; requestId: string; messageId?: string }
  | {
      ok: false;
      status: "rejected" | "uncertain";
      code: string;
      message: string;
      requestId?: string;
    };

/** What the provider server needs from a bridge. */
export interface Bridge {
  sessionId: string;
  getSnapshot(): { seq: number; snapshot: Snapshot };
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  send(text: string, requestId: string): Promise<SendOutcome>;
}

export interface SessionBridge extends Bridge {
  /** Resolves once history has been merged (or failed to load). */
  ready: Promise<void>;
  dispose(): void;
}

export interface SessionBridgeOptions {
  store?: TranscriptStore;
  log?: Logger;
  coalesceMs?: number;
  sendTimeoutMs?: number;
}

type Attempt = { messageId: string } | { error: unknown };

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  const trimmed = message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE);
  return trimmed || "The session did not accept the message.";
}

export function createSessionBridge(
  session: SessionLike,
  {
    store = createTranscriptStore(),
    log = () => {},
    coalesceMs = DEFAULT_COALESCE_MS,
    sendTimeoutMs = LIMITS.sendTimeoutMs,
  }: SessionBridgeOptions = {},
): SessionBridge {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const pendingStreaming = new Map<string, TranscriptEntry>();
  const requests = new Set<string>();
  const cancelTimers = new Set<() => void>();
  let seq = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function notify(event: BridgeEvent): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        log(`Bridge listener failed: ${describeError(error)}`, "warning");
      }
    }
  }

  function emitNow(change: TranscriptChange): void {
    seq += 1;
    if (change.type === "entry") {
      notify({ seq, type: "entry", entry: { ...change.entry } });
    } else {
      notify({ seq, type: "status", status: { ...change.status } });
    }
  }

  function flushStreaming(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const batch = [...pendingStreaming.values()];
    pendingStreaming.clear();
    for (const entry of batch) emitNow({ type: "entry", entry });
  }

  function emit(changes: readonly TranscriptChange[]): void {
    if (disposed) return;
    for (const change of changes) {
      if (change.type === "entry" && change.entry.streaming === true) {
        pendingStreaming.set(change.entry.id, change.entry);
        if (flushTimer === null) flushTimer = setTimeout(flushStreaming, coalesceMs);
        continue;
      }
      if (change.type === "entry") pendingStreaming.delete(change.entry.id);
      emitNow(change);
    }
  }

  function onSessionEvent(event: SessionEventLike): void {
    try {
      emit(store.applyEvent(event));
    } catch (error) {
      log(`Failed to apply session event: ${describeError(error)}`, "warning");
    }
  }

  // Subscribe first; history is merged afterwards and overlaps are de-duplicated by the store.
  const unsubscribeSession = session.on(onSessionEvent);

  const ready = (async () => {
    try {
      const history = await session.getEvents();
      if (!disposed && Array.isArray(history)) emit(store.mergeHistory(history));
    } catch (error) {
      log(`Could not load session history: ${describeError(error)}`, "warning");
    }
  })();

  function getSnapshot(): { seq: number; snapshot: Snapshot } {
    return { seq, snapshot: store.snapshot() };
  }

  function subscribe(listener: (event: BridgeEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function admit(messageId: unknown, requestId: string): void {
    if (typeof messageId === "string" && messageId.length > 0) {
      emit(store.tagRequest(messageId, requestId));
    }
  }

  function remember(requestId: string): void {
    requests.add(requestId);
    if (requests.size > MAX_TRACKED_REQUESTS) {
      const oldest = requests.values().next().value;
      if (oldest !== undefined) requests.delete(oldest);
    }
  }

  function uncertain(requestId: string, message: string): SendOutcome {
    return {
      ok: false,
      status: SEND_STATUS.uncertain,
      code: ERROR_CODES.sendUncertain,
      message,
      requestId,
    };
  }

  async function send(text: string, requestId: string): Promise<SendOutcome> {
    if (disposed) {
      return {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.sendFailed,
        message: "The session is no longer connected.",
        requestId,
      };
    }
    // Recorded before any await so a repeat can never reach session.send twice.
    if (requests.has(requestId)) {
      return {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.duplicateRequest,
        message: "This request was already submitted.",
        requestId,
      };
    }
    remember(requestId);

    const attempt: Promise<Attempt> = Promise.resolve()
      .then(() => session.send({ prompt: text }))
      .then(
        (messageId): Attempt => ({ messageId }),
        (error: unknown): Attempt => ({ error }),
      );

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const timedOut = new Promise<"timeout">((resolve) => {
      cancel = () => resolve("timeout");
      cancelTimers.add(cancel);
      timer = setTimeout(cancel, sendTimeoutMs);
    });

    const winner = await Promise.race([attempt, timedOut]);
    clearTimeout(timer);
    cancelTimers.delete(cancel);

    if (winner === "timeout") {
      // The send may still land; tag it when it does, but never re-send.
      void attempt.then((late) => {
        if ("error" in late) {
          log(`Late send failure: ${describeError(late.error)}`, "warning");
        } else {
          admit(late.messageId, requestId);
        }
      });
      return uncertain(
        requestId,
        "The session did not confirm the message in time. It might not have been delivered.",
      );
    }
    if ("error" in winner) {
      requests.delete(requestId);
      return {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.sendFailed,
        message: describeError(winner.error),
        requestId,
      };
    }
    admit(winner.messageId, requestId);
    const outcome: SendOutcome = { ok: true, status: SEND_STATUS.accepted, requestId };
    if (typeof winner.messageId === "string") outcome.messageId = winner.messageId;
    return outcome;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      unsubscribeSession();
    } catch {
      // Session may already be disconnected.
    }
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    pendingStreaming.clear();
    for (const cancel of Array.from(cancelTimers)) cancel();
    cancelTimers.clear();
    listeners.clear();
  }

  return { sessionId: session.sessionId, ready, getSnapshot, subscribe, send, dispose };
}
