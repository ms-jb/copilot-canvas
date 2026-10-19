import type {
  ActivityItem,
  ContextState,
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
  | { seq: number; type: "prompts"; prompts: PendingPrompt[] }
  | { seq: number; type: "context"; context: ContextState }
  | { seq: number; type: "activity"; item: ActivityItem };
type Change =
  | TranscriptChange
  | { type: "controls"; controls: SessionControls }
  | { type: "queue"; queue: QueueState }
  | { type: "prompts"; prompts: PendingPrompt[] }
  | { type: "context"; context: ContextState };

/** Streaming text (a reply or thinking) is coalesced; everything else is sent at once. */
type StreamingChange =
  | { type: "entry"; entry: TranscriptEntry }
  | { type: "activity"; item: ActivityItem };
function streamingKey(change: TranscriptChange): string | null {
  if (change.type === "entry") return `entry:${change.entry.id}`;
  if (change.type === "activity") return `activity:${change.item.id}`;
  return null;
}
const isStreaming = (change: TranscriptChange): change is StreamingChange =>
  (change.type === "entry" && change.entry.streaming === true) ||
  (change.type === "activity" &&
    change.item.kind === "reasoning" &&
    change.item.streaming === true);

/** One sequence for transcript, controls and prompts; streaming text alone is coalesced. */
export function createEventSequencer({ log, coalesceMs }: { log: Logger; coalesceMs: number }) {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const pendingStreaming = new Map<string, StreamingChange>();
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
          : change.type === "activity"
            ? { seq, type: "activity", item: { ...change.item } }
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
    for (const change of batch) emitNow(change);
  }
  function emit(changes: readonly TranscriptChange[]): void {
    if (disposed) return;
    for (const change of changes) {
      const key = streamingKey(change);
      if (key !== null && isStreaming(change)) {
        pendingStreaming.set(key, change);
        if (flushTimer === null) flushTimer = setTimeout(flushStreaming, coalesceMs);
        continue;
      }
      if (key !== null) pendingStreaming.delete(key);
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
