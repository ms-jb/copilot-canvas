import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  createSendPress,
  QUEUE_HOLD_MS,
  queueHintAfter,
  queuesOnEnter,
} from "../../ui/src/components/sendPress";

afterEach(() => vi.useRealTimers());

it("sends immediately for a short mouse or touch press", () => {
  vi.useFakeTimers();
  const queue = vi.fn();
  const press = createSendPress(queue);
  press.start();
  vi.advanceTimersByTime(QUEUE_HOLD_MS - 1);
  press.release();
  expect(queue).not.toHaveBeenCalled();
  expect(press.click()).toBe(true);
  vi.advanceTimersByTime(QUEUE_HOLD_MS);
  expect(queue).not.toHaveBeenCalled();
});

it("arms at 500ms, queues once on release and consumes the trailing click", () => {
  vi.useFakeTimers();
  const queue = vi.fn();
  const armed = vi.fn();
  const press = createSendPress(queue, armed);
  press.start();
  vi.advanceTimersByTime(QUEUE_HOLD_MS);
  expect(armed).toHaveBeenLastCalledWith(true);
  expect(queue).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2000);
  press.release();
  expect(queue).toHaveBeenCalledTimes(1);
  expect(armed).toHaveBeenLastCalledWith(false);
  // The click after the hold is consumed even if Send has become Stop meanwhile.
  expect(press.click()).toBe(false);
  press.start();
  press.release();
  expect(press.click()).toBe(true);
  expect(queue).toHaveBeenCalledTimes(1);
});

it("disarms without queueing when an armed hold leaves the button or is cancelled", () => {
  vi.useFakeTimers();
  const queue = vi.fn();
  const armed = vi.fn();
  const press = createSendPress(queue, armed);
  press.start();
  vi.advanceTimersByTime(QUEUE_HOLD_MS);
  press.cancel();
  expect(armed.mock.calls).toEqual([[true], [false]]);
  press.release();
  expect(queue).not.toHaveBeenCalled();
  expect(press.click()).toBe(false);
});

it("cancels when leaving, scrolling or unmounting; keyboard activation starts clean", () => {
  vi.useFakeTimers();
  const queue = vi.fn();
  const press = createSendPress(queue);
  press.start();
  vi.advanceTimersByTime(200);
  press.cancel();
  vi.advanceTimersByTime(1000);
  expect(queue).not.toHaveBeenCalled();
  expect(press.click()).toBe(false);
  press.cancel();
  expect(press.click()).toBe(true);
  press.start();
  press.cancel();
  press.keyboard();
  expect(press.click()).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("queues with Ctrl, Cmd or Alt and Enter, and sends now with plain Enter", () => {
  const keys = { ctrlKey: false, metaKey: false, altKey: false };
  expect(queuesOnEnter(keys)).toBe(false);
  expect(queuesOnEnter({ ...keys, ctrlKey: true })).toBe(true);
  expect(queuesOnEnter({ ...keys, metaKey: true })).toBe(true);
  expect(queuesOnEnter({ ...keys, altKey: true })).toBe(true);
});

it("hints Queue only while Ctrl or Cmd is held in the composer, and drops it on leaving", () => {
  const key = (type: "keydown" | "keyup", keys: { ctrlKey?: boolean; metaKey?: boolean }) => ({
    type,
    ctrlKey: false,
    metaKey: false,
    composerFocused: true,
    ...keys,
  });
  expect(queueHintAfter(key("keydown", { ctrlKey: true }))).toBe(true);
  expect(queueHintAfter(key("keydown", { metaKey: true }))).toBe(true);
  // Releasing Control reports ctrlKey false on its own key-up.
  expect(queueHintAfter(key("keyup", {}))).toBe(false);
  expect(queueHintAfter({ ...key("keydown", { ctrlKey: true }), composerFocused: false })).toBe(
    false,
  );
  expect(queueHintAfter(key("keydown", {}))).toBe(false);
  for (const type of ["blur", "hidden", "focusout"] as const) {
    expect(queueHintAfter({ type })).toBe(false);
  }
});
