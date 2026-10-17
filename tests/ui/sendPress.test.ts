import { afterEach, expect, it, vi } from "vite-plus/test";
import { createSendPress, QUEUE_HOLD_MS } from "../../ui/src/components/sendPress";

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

it("queues at 500ms once and consumes the trailing click, including when Send becomes Stop", () => {
  vi.useFakeTimers();
  const queue = vi.fn();
  const press = createSendPress(queue);
  press.start();
  vi.advanceTimersByTime(QUEUE_HOLD_MS);
  expect(queue).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2000);
  press.release();
  expect(press.click()).toBe(false);
  expect(queue).toHaveBeenCalledTimes(1);
  press.start();
  press.release();
  expect(press.click()).toBe(true);
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
