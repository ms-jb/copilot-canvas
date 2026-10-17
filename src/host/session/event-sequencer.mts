import type {
  PendingPrompt,
  SessionControls,
  SessionStatus,
  TranscriptEntry,
  QueueState,
} from "../../shared/contract.mts";
import type { TranscriptChange } from "../../shared/transcript.mts";
import { describeSessionError } from "../logging.mts";
import type { Logger } from "../logging.mts";

export type BridgeEvent =
  | { seq: number; type: "entry"; entry: TranscriptEntry }
  | { seq: number; type: "status"; status: SessionStatus }
  | { seq: number; type: "controls"; controls: SessionControls }
  | { seq: number; type: "queue"; queue: QueueState }
  | { seq: number; type: "prompts"; prompts: PendingPrompt[] };
type Change =
  | TranscriptChange
  | { type: "controls"; controls: SessionControls }
  | { type: "queue"; queue: QueueState }
  | { type: "prompts"; prompts: PendingPrompt[] };

/** One sequence for transcript, controls and prompts; streaming entries alone are coalesced. */
export function createEventSequencer({ log, coalesceMs }: { log: Logger; coalesceMs: number }) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const pendingStreaming = new Map<string, TranscriptEntry>();
  let seq = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function emitNow(change: Change): void {
    seq += 1;
    const event: BridgeEvent =
      change.type === "entry"
        ? { seq, type: "entry", entry: { ...change.entry } }
        : change.type === "status"
          ? { seq, type: "status", status: { ...change.status } }
          : { seq, ...change };
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        log(`Bridge listener failed: ${describeSessionError(error)}`, "warning");
      }
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
  return {
    get seq() {
      return seq;
    },
    emit,
    emitNow,
    subscribe(this: void, listener: (event: BridgeEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      if (flushTimer !== null) clearTimeout(flushTimer);
      flushTimer = null;
      pendingStreaming.clear();
      listeners.clear();
    },
  };
}
