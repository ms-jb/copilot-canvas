import type { ServerEvent } from "../shared";

export interface StreamBatchScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface StreamBatcher {
  push(event: ServerEvent): void;
  flush(): void;
  dispose(): void;
}

/** Events that should not wait for the next frame when text is buffered. */
export function flushesBufferedText(event: ServerEvent): boolean {
  switch (event.name) {
    case "snapshot":
      return true;
    case "status":
      return event.data.status.phase !== "working";
    case "entry":
      return event.data.entry.kind === "error" || event.data.entry.streaming !== true;
    default:
      return false;
  }
}

interface StreamBatchOptions {
  commit: (events: ServerEvent[]) => void;
  scheduler: StreamBatchScheduler;
  frameFallbackMs: number;
}

/** Coalesces streamed `append` deltas and commits at most once per animation frame. */
export function createStreamBatcher({
  commit,
  scheduler,
  frameFallbackMs,
}: StreamBatchOptions): StreamBatcher {
  let frame: number | undefined;
  let timer: unknown;
  let queued: ServerEvent[] = [];
  const appendByTarget = new Map<string, number>();

  const clearScheduled = () => {
    if (frame !== undefined) scheduler.cancelFrame(frame);
    scheduler.clearTimer(timer);
    frame = undefined;
    timer = undefined;
  };

  const flush = () => {
    clearScheduled();
    if (queued.length === 0) return;
    const batch = queued;
    queued = [];
    appendByTarget.clear();
    commit(batch);
  };

  const schedule = () => {
    if (frame !== undefined || timer !== undefined) return;
    frame = scheduler.requestFrame(flush);
    timer = scheduler.setTimer(flush, frameFallbackMs);
  };

  const pushAppend = (event: Extract<ServerEvent, { name: "append" }>) => {
    const key = `${event.data.target}:${event.data.id}`;
    const index = appendByTarget.get(key);
    // Only adjacent deltas can be folded without reordering the global event sequence.
    if (index === undefined || index !== queued.length - 1) {
      appendByTarget.set(key, queued.length);
      queued.push(event);
      return;
    }
    const previous = queued[index];
    if (!previous || previous.name !== "append") {
      appendByTarget.delete(key);
      appendByTarget.set(key, queued.length);
      queued.push(event);
      return;
    }
    queued[index] = {
      name: "append",
      data: {
        ...previous.data,
        seq: event.data.seq,
        text: previous.data.text + event.data.text,
      },
    };
  };

  return {
    push(event) {
      if (event.name === "append") {
        pushAppend(event);
      } else {
        appendByTarget.clear();
        queued.push(event);
      }
      schedule();
    },
    flush,
    dispose() {
      flush();
      clearScheduled();
      queued = [];
      appendByTarget.clear();
    },
  };
}
