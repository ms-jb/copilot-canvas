// Subscribe before loading history; compose independently testable session services.
import { LIMITS } from "../../shared/contract.mts";
import type {
  ControlChange,
  PromptResponse,
  SessionControls,
  Snapshot,
  SendAttachment,
  SendMode,
} from "../../shared/contract.mts";
import { createTranscriptStore } from "../../shared/transcript.mts";
import type { SessionEventLike, TranscriptStore } from "../../shared/transcript.mts";
import { createControlsService } from "../controls/service.mts";
import type { ControlsService } from "../controls/service.mts";
import type { ControlsRpcLike } from "../controls/rpc-adapter.mts";
import { createPromptService } from "../prompts/service.mts";
import type { PromptService } from "../prompts/service.mts";
import type { PromptsRpcLike, RespondOutcome } from "../prompts/rpc-adapter.mts";
import { describeSessionError } from "../logging.mts";
import type { Logger } from "../logging.mts";
import { createEventSequencer } from "./event-sequencer.mts";
import type { BridgeEvent } from "./event-sequencer.mts";
import { createSendController } from "./send-controller.mts";
import type { NativeAttachment } from "./attachments.mts";
import type { SendOutcome } from "./send-controller.mts";
import { createSessionActions } from "./actions.mts";
import type { ExtensionsRpcLike } from "./actions.mts";
import { createQueueTracker, type QueueRpcLike } from "./queue.mts";

/** The slice of the SDK session the bridge uses. Tests can pass a fake. */
export interface SessionLike {
  sessionId: string;
  on(handler: (event: SessionEventLike) => void): () => void;
  getEvents(): Promise<readonly SessionEventLike[]>;
  send(options: {
    prompt: string;
    attachments?: NativeAttachment[];
    mode?: SendMode;
  }): Promise<string>;
  readonly rpc?: ControlsRpcLike &
    PromptsRpcLike & {
      extensions?: ExtensionsRpcLike;
      abort?: (params: { reason?: string }) => Promise<unknown>;
      queue?: QueueRpcLike;
    };
}
/** What the provider server needs from a bridge. */
export interface Bridge {
  sessionId: string;
  getSnapshot(): { seq: number; snapshot: Snapshot; controls: SessionControls };
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  send(
    text: string,
    requestId: string,
    attachments?: SendAttachment[],
    mode?: SendMode,
  ): Promise<SendOutcome>;
  /** Rejects with a `ControlError` from controls.mts. */
  applyControl(change: ControlChange): Promise<SessionControls>;
  /** Schedules a reload shortly. False when this Copilot cannot. */
  reloadExtensions(): boolean;
  /** "stopped" only when confirmed by the session; "unavailable" when no abort API exists. */
  stop(): Promise<"stopped" | "unavailable" | "failed">;
  respond(requestId: string, response: PromptResponse): Promise<RespondOutcome>;
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

export function createSessionBridge(
  session: SessionLike,
  {
    store = createTranscriptStore(),
    log = () => {},
    controls = createControlsService(session, { log }),
    prompts = createPromptService(session, { log }),
    coalesceMs = 50,
    sendTimeoutMs = LIMITS.sendTimeoutMs,
  }: SessionBridgeOptions = {},
): SessionBridge {
  let disposed = false;
  const events = createEventSequencer({ log, coalesceMs });
  const queue = createQueueTracker(session.rpc?.queue, (state) => {
    if (!disposed) events.emitNow({ type: "queue", queue: state });
  });
  const sends = createSendController(session, {
    log,
    sendTimeoutMs,
    admit(messageId, requestId, mode) {
      if (typeof messageId === "string" && messageId.length > 0) {
        events.emit(store.tagRequest(messageId, requestId));
        if (mode === "enqueue") queue.admitted(messageId, requestId);
      }
    },
  });
  const actions = createSessionActions(session, log);
  function onSessionEvent(event: SessionEventLike): void {
    if (!event.agentId) {
      if (event.type === "user.message") {
        const id = event.data?.messageId ?? event.id;
        if (typeof id === "string") queue.confirmed(id);
      }
      if (["abort", "session.idle", "pending_messages.modified"].includes(event.type)) {
        void queue.refresh();
      }
    }
    try {
      events.emit(store.applyEvent(event));
    } catch (error) {
      log(`Failed to apply session event: ${describeSessionError(error)}`, "warning");
    }
    try {
      prompts.applyEvent(event);
    } catch (error) {
      log(`Failed to track a pending request: ${describeSessionError(error)}`, "warning");
    }
  }
  // History overlaps live events; the transcript store de-duplicates them by event id.
  const unsubscribeSession = session.on(onSessionEvent);
  const unsubscribeControls = controls.subscribe((next) => {
    if (!disposed) events.emitNow({ type: "controls", controls: next });
  });
  const unsubscribePrompts = prompts.subscribe((next) => {
    if (!disposed) events.emitNow({ type: "prompts", prompts: next });
  });
  const history = (async () => {
    try {
      const historyEvents = await session.getEvents();
      if (!disposed && Array.isArray(historyEvents)) events.emit(store.mergeHistory(historyEvents));
    } catch (error) {
      log(`Could not load session history: ${describeSessionError(error)}`, "warning");
    }
  })();
  const ready = Promise.all([history, controls.ready, prompts.ready]).then(() => undefined);
  return {
    sessionId: session.sessionId,
    ready,
    getSnapshot: () => ({
      seq: events.seq,
      snapshot: { ...store.snapshot(), prompts: prompts.list(), queue: queue.snapshot() },
      controls: controls.get(),
    }),
    subscribe: events.subscribe,
    send: sends.send,
    applyControl: (change) => controls.apply(change),
    reloadExtensions: actions.reloadExtensions,
    stop: async () => {
      const outcome = await actions.stop();
      if (outcome === "stopped") void queue.refresh();
      return outcome;
    },
    respond: (requestId, response) => prompts.respond(requestId, response),
    refreshPrompts: () => prompts.refresh(),
    dispose() {
      if (disposed) return;
      disposed = true;
      actions.dispose();
      try {
        unsubscribeSession();
      } catch {
        // Session may already be disconnected.
      }
      unsubscribeControls();
      controls.dispose();
      unsubscribePrompts();
      prompts.dispose();
      events.dispose();
      sends.dispose();
      queue.dispose();
    },
  };
}
