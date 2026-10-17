import { describe, expect, it } from "vite-plus/test";
import {
  advanceSwipe,
  startSwipe,
  SWIPE_DISTANCE,
  SWIPE_EDGE,
  SWIPE_LOCK_DISTANCE,
  type SwipeGuards,
  type SwipeState,
} from "../../ui/src/layout/swipe";

const start = {
  phone: true,
  drawer: null,
  onChat: true,
  x: 180,
  width: 390,
  touchCount: 1,
} as const;

function gesture(overrides: Partial<Parameters<typeof startSwipe>[0]> = {}): SwipeState {
  const state = startSwipe({ ...start, ...overrides });
  expect(state).not.toBeNull();
  return state!;
}

function move(state: SwipeState, dx: number, dy = 0, guards: Partial<SwipeGuards> = {}) {
  return advanceSwipe(state, { dx, dy, touchCount: 1, ...guards });
}

describe("phone swipe navigation", () => {
  it("opens navigation to the right and details to the left on chat", () => {
    expect(move(gesture(), SWIPE_DISTANCE).action).toBe("open-sidebar");
    expect(move(gesture(), -SWIPE_DISTANCE).action).toBe("open-aside");
  });

  it("does not enable navigation outside the phone layout", () => {
    expect(startSwipe({ ...start, phone: false })).toBeNull();
    expect(startSwipe({ ...start, phone: false, drawer: "aside" })).toBeNull();
  });

  it("opens navigation only from the left edge outside chat, including the exact boundary", () => {
    const leftEdge = gesture({ onChat: false, x: SWIPE_EDGE });
    expect(move(leftEdge, SWIPE_DISTANCE).action).toBe("open-sidebar");
    expect(move(leftEdge, -SWIPE_DISTANCE).action).toBe("open-aside");
    const rightEdge = gesture({ onChat: false, x: start.width - SWIPE_EDGE });
    expect(move(rightEdge, -SWIPE_DISTANCE).action).toBe("open-aside");
    expect(move(rightEdge, SWIPE_DISTANCE).preventDefault).toBe(false);
    const middle = gesture({ onChat: false, x: SWIPE_EDGE + 1 });
    expect(move(middle, SWIPE_DISTANCE).action).toBeNull();
    expect(move(middle, -SWIPE_DISTANCE).action).toBe("open-aside");
    expect(startSwipe({ ...start, x: -1 })).toBeNull();
    expect(startSwipe({ ...start, x: start.width + 1 })).toBeNull();
  });

  it("closes each drawer only toward its own edge, even from the opposite edge", () => {
    const sidebar = gesture({ drawer: "sidebar", x: start.width });
    expect(move(sidebar, -SWIPE_DISTANCE).action).toBe("close");
    expect(move(sidebar, SWIPE_DISTANCE).preventDefault).toBe(false);
    const aside = gesture({ drawer: "aside", x: 0 });
    expect(move(aside, SWIPE_DISTANCE).action).toBe("close");
    expect(move(aside, -SWIPE_DISTANCE).preventDefault).toBe(false);
  });

  it("leaves taps and jitter alone, locks at 12px, and acts only at 48px", () => {
    const state = gesture();
    expect(move(state, SWIPE_LOCK_DISTANCE - 1)).toEqual({
      state,
      action: null,
      preventDefault: false,
    });
    const locked = move(state, SWIPE_LOCK_DISTANCE);
    expect(locked.state.direction).toBe("right");
    expect(locked.preventDefault).toBe(true);
    expect(locked.action).toBeNull();
    expect(move(locked.state, SWIPE_DISTANCE - 1).action).toBeNull();
    expect(move(locked.state, SWIPE_DISTANCE).action).toBe("open-sidebar");
  });

  it("requires 2:1 horizontal dominance at direction lock", () => {
    expect(move(gesture(), 12, 6).state.direction).toBe("right");
    expect(move(gesture(), 12, 7).state.direction).toBe("cancelled");
    expect(move(gesture(), -12, -6).state.direction).toBe("left");
  });

  it.each([
    [0, 12],
    [6, -12],
    [12, 12],
    [-30, 20],
  ])("never hijacks a vertical/diagonal scroll that starts with (%i, %i)", (dx, dy) => {
    const scrolling = move(gesture(), dx, dy);
    expect(scrolling.preventDefault).toBe(false);
    expect(scrolling.action).toBeNull();
    const later = move(scrolling.state, 100, 20);
    expect(later.preventDefault).toBe(false);
    expect(later.action).toBeNull();
  });

  it("keeps horizontal direction locked, and cancels a reversal", () => {
    const locked = move(gesture(), -12).state;
    expect(move(locked, -48, 25).action).toBe("open-aside");
    const reversed = move(locked, 12);
    expect(reversed.preventDefault).toBe(false);
    expect(move(reversed.state, 48).action).toBeNull();
  });

  it("does not activate the other drawer after an outward edge gesture", () => {
    const state = gesture({ onChat: false, x: start.width });
    const outward = move(state, 12);
    expect(move(outward.state, -48).action).toBeNull();
  });

  it.each(["horizontalScroller", "interactive", "selection", "overlay"] as const)(
    "ignores %s at every origin, even the edge or an open drawer",
    (guard) => {
      for (const origin of [
        start,
        { ...start, x: 0 },
        { ...start, x: 390 },
        { ...start, drawer: "sidebar" as const },
        { ...start, drawer: "aside" as const },
      ]) {
        expect(startSwipe({ ...origin, [guard]: true })).toBeNull();
      }
      const locked = move(gesture(), 12).state;
      const ignored = move(locked, 48, 0, { [guard]: true });
      expect(ignored.preventDefault).toBe(false);
      expect(ignored.action).toBeNull();
      expect(move(ignored.state, 80).action).toBeNull();
    },
  );

  it.each([0, 2, 3])(
    "ignores %i fingers, including a second finger after direction lock",
    (count) => {
      expect(startSwipe({ ...start, touchCount: count })).toBeNull();
      const ignored = move(move(gesture(), 12).state, 48, 0, { touchCount: count });
      expect(ignored.action).toBeNull();
      expect(ignored.preventDefault).toBe(false);
      expect(move(ignored.state, 80).action).toBeNull();
    },
  );

  it("runs only once per gesture and releases scrolling if an overlay opens afterward", () => {
    const completed = move(gesture(), 48);
    expect(completed.state.direction).toBe("complete");
    expect(move(completed.state, 90).action).toBeNull();
    expect(move(completed.state, -90).action).toBeNull();
    expect(move(completed.state, 90).preventDefault).toBe(true);
    expect(move(completed.state, 90, 0, { overlay: true }).preventDefault).toBe(false);
  });
});
