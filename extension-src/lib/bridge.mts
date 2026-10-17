// Session bridge: connects one joined Copilot session to the provider server.
//
// - Subscribes to live session events BEFORE reading history, then merges history (the
//   transcript store de-duplicates by event id, so the overlap is harmless).
// - Turns store changes into sequence-numbered change events for subscribers.
// - Coalesces streaming entry updates (~50ms) so SSE clients are not flooded.
// - Sends composer text through the joined session (never sendAndWait) with a timeout that
//   reports "uncertain" instead of ever re-sending.
// - Mirrors the requests the session waits on (permissions, questions, forms, plan approvals) through
//   the prompt service and answers one only when the user explicitly does so (see prompts.mts).
// - Owns the native controls service and numbers its changes on the same sequence as transcript
//   events, so clients apply them in order.

import { ERROR_CODES, LIMITS, SEND_STATUS } from "../shared/contract.mts";
import type {
  ControlChange,
  PendingPrompt,
  PromptResponse,
  SessionControls,
  SessionStatus,
  Snapshot,
  TranscriptEntry,
} from "../shared/contract.mts";
import { createTranscriptStore } from "../shared/transcript.mts";
import type { SessionEventLike, TranscriptChange, TranscriptStore } from "../shared/transcript.mts";
import { createControlsService } from "./controls.mts";
import type { ControlsRpcLike, ControlsService } from "./controls.mts";
import { createPromptService } from "./prompts.mts";
import type { PromptService, PromptsRpcLike, RespondOutcome } from "./prompts.mts";

const DEFAULT_COALESCE_MS = 50;
const MAX_TRACKED_REQUESTS = 500;
const MAX_ERROR_MESSAGE = 300;
const RELOAD_DELAY_MS = 250;

/** The slice of the SDK session the bridge uses. Tests can pass a fake. */
export interface SessionLike {
  sessionId: string;
  on(handler: (event: SessionEventLike) => void): () => void;
  getEvents(): Promise<readonly SessionEventLike[]>;
  send(options: { prompt: string }): Promise<string>;
  readonly rpc?: ControlsRpcLike &
    PromptsRpcLike & {
      extensions?: ExtensionsRpcLike;
      abort?: (params: { reason?: string }) => Promise<unknown>;
    };
}

/** Experimental like the other RPCs, so feature-detected before use. */
export interface ExtensionsRpcLike {
  reload?: () => Promise<void>;
}

export type LogLevel = "info" | "warning" | "error";
export type Logger = (message: string, level?: LogLevel) => void;

export type BridgeEvent =
  | { seq: number; type: "entry"; entry: TranscriptEntry }
  | { seq: number; type: "status"; status: SessionStatus }
  | { seq: number; type: "controls"; controls: SessionControls }
  | { seq: number; type: "prompts"; prompts: PendingPrompt[] };

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
  getSnapshot(): { seq: number; snapshot: Snapshot; controls: SessionControls };
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  send(text: string, requestId: string): Promise<SendOutcome>;
  /** Applies one native setting change. Rejects with a `ControlError` from controls.mts. */
  applyControl(change: ControlChange): Promise<SessionControls>;
  /** Asks the session to reload its extensions shortly. False when this Copilot cannot. */
  reloadExtensions(): boolean;
  /**
   * Stops the running turn, as the app's own Stop does. "stopped" only when the session confirms;
   * "unavailable" when this Copilot has no abort. With nothing running, the session answers itself.
   */
  stop(): Promise<"stopped" | "unavailable" | "failed">;
  /** Answers one pending prompt with the user's explicit decision. */
  respond(requestId: string, response: PromptResponse): Promise<RespondOutcome>;
  /** Re-reads pending requests from the session (for example when a client reconnects). */
  refreshPrompts(): void;
}

export interface SessionBridge extends Bridge {
  /** Resolves once history has been merged (or failed to load). */
  ready: Promise<void>;
  dispose(): void;
}

export interface SessionBridgeOptions {
  store?: TranscriptStore;
  /** Defaults to a service over `session.rpc`; disposed with the bridge. */
  controls?: ControlsService;
  /** Defaults to a service over `session.rpc`; disposed with the bridge. */
  prompts?: PromptService;
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
    controls = createControlsService(session, { log }),
    prompts = createPromptService(session, { log }),
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
  let reloadScheduled = false;

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
    try {
      prompts.applyEvent(event);
    } catch (error) {
      log(`Failed to track a pending request: ${describeError(error)}`, "warning");
    }
  }

  // Subscribe first; history is merged afterwards and overlaps are de-duplicated by the store.
  const unsubscribeSession = session.on(onSessionEvent);

  const unsubscribeControls = controls.subscribe((next) => {
    if (disposed) return;
    seq += 1;
    notify({ seq, type: "controls", controls: next });
  });

  const unsubscribePrompts = prompts.subscribe((next) => {
    if (disposed) return;
    seq += 1;
    notify({ seq, type: "prompts", prompts: next });
  });

  const history = (async () => {
    try {
      const events = await session.getEvents();
      if (!disposed && Array.isArray(events)) emit(store.mergeHistory(events));
    } catch (error) {
      log(`Could not load session history: ${describeError(error)}`, "warning");
    }
  })();
  const ready = Promise.all([history, controls.ready, prompts.ready]).then(() => undefined);

  function getSnapshot(): { seq: number; snapshot: Snapshot; controls: SessionControls } {
    return {
      seq,
      snapshot: { ...store.snapshot(), prompts: prompts.list() },
      controls: controls.get(),
    };
  }

  function applyControl(change: ControlChange): Promise<SessionControls> {
    return controls.apply(change);
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

  /**
   * Schedules a reload of this session's extensions, this one included. The reload restarts the
   * provider, so the caller's reply must go out first; hence the short delay.
   */
  function reloadExtensions(): boolean {
    if (disposed) return false;
    let api: ExtensionsRpcLike | undefined;
    try {
      api = session.rpc?.extensions;
    } catch {
      return false;
    }
    if (!api || typeof api.reload !== "function") return false;
    if (!reloadScheduled) {
      reloadScheduled = true;
      setTimeout(() => {
        Promise.resolve()
          .then(() => api.reload?.())
          .catch((error: unknown) => {
            log(`Reloading extensions failed: ${describeError(error)}`, "warning");
          })
          .finally(() => {
            reloadScheduled = false;
          });
      }, RELOAD_DELAY_MS);
    }
    return true;
  }

  async function stop(): Promise<"stopped" | "unavailable" | "failed"> {
    if (disposed) return "unavailable";
    const rpc = session.rpc;
    if (!rpc || typeof rpc.abort !== "function") return "unavailable";
    try {
      const result: unknown = await rpc.abort({ reason: "user_initiated" });
      const ok =
        typeof result === "object" && result !== null && "success" in result && result.success;
      return ok === true ? "stopped" : "failed";
    } catch (error) {
      log(`Stopping the turn failed: ${describeError(error)}`, "warning");
      return "failed";
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      unsubscribeSession();
    } catch {
      // Session may already be disconnected.
    }
    unsubscribeControls();
    controls.dispose();
    unsubscribePrompts();
    prompts.dispose();
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    pendingStreaming.clear();
    for (const cancel of Array.from(cancelTimers)) cancel();
    cancelTimers.clear();
    listeners.clear();
  }

  return {
    sessionId: session.sessionId,
    ready,
    getSnapshot,
    subscribe,
    send,
    applyControl,
    reloadExtensions,
    stop,
    respond: (requestId, response) => prompts.respond(requestId, response),
    refreshPrompts: () => prompts.refresh(),
    dispose,
  };
}
