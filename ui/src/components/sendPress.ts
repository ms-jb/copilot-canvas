export const QUEUE_HOLD_MS = 500;

/** A hold queues once; its eventual click is consumed even if Send has changed into Stop. */
export function createSendPress(onQueue: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consumed = false;
  let active = false;
  const release = () => {
    clearTimeout(timer);
    timer = undefined;
    active = false;
  };
  return {
    start() {
      release();
      consumed = false;
      active = true;
      timer = setTimeout(() => {
        timer = undefined;
        consumed = true;
        onQueue();
      }, QUEUE_HOLD_MS);
    },
    release,
    cancel(this: void) {
      if (active) consumed = true;
      release();
    },
    keyboard() {
      release();
      consumed = false;
    },
    click() {
      release();
      if (consumed) {
        consumed = false;
        return false;
      }
      return true;
    },
  };
}
