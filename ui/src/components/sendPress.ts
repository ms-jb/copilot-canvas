export const QUEUE_HOLD_MS = 500;

/** Ctrl, Cmd or Alt with Enter queues the message instead of sending it now. */
export function queuesOnEnter(event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  return event.ctrlKey || event.metaKey || event.altKey;
}

export type QueueHintEvent =
  | { type: "keydown" | "keyup"; ctrlKey: boolean; metaKey: boolean; composerFocused: boolean }
  | { type: "blur" | "hidden" | "focusout" };

/**
 * Whether Send should show that it will queue, after a keyboard or focus event: Ctrl or Cmd held
 * while the composer has focus. Alt+Enter queues too, but Alt types characters on macOS, so it
 * gives no hint. Leaving the window or the composer drops the hint, since its key-up never comes.
 */
export function queueHintAfter(event: QueueHintEvent): boolean {
  if (event.type !== "keydown" && event.type !== "keyup") return false;
  return event.composerFocused && (event.ctrlKey || event.metaKey);
}

/**
 * A hold past QUEUE_HOLD_MS arms queueing (`onArmed(true)`, so Send can show it) and queues on
 * release; leaving or cancelling first disarms without sending. A hold's trailing click is
 * consumed even if Send has changed into Stop.
 */
export function createSendPress(onQueue: () => void, onArmed: (armed: boolean) => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consumed = false;
  let active = false;
  let armed = false;
  const setArmed = (next: boolean) => {
    if (armed === next) return;
    armed = next;
    onArmed(next);
  };
  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
    active = false;
    setArmed(false);
  };
  return {
    start() {
      reset();
      consumed = false;
      active = true;
      timer = setTimeout(() => {
        timer = undefined;
        setArmed(true);
      }, QUEUE_HOLD_MS);
    },
    release(this: void) {
      const queue = armed;
      reset();
      if (!queue) return;
      consumed = true;
      onQueue();
    },
    cancel(this: void) {
      if (active) consumed = true;
      reset();
    },
    keyboard() {
      reset();
      consumed = false;
    },
    click() {
      reset();
      if (consumed) {
        consumed = false;
        return false;
      }
      return true;
    },
  };
}
