export type SwipeDrawer = "sidebar" | "aside" | null;
export type SwipeAction = "open-sidebar" | "open-aside" | "close";

export const SWIPE_EDGE = 24;
export const SWIPE_LOCK_DISTANCE = 12;
export const SWIPE_DISTANCE = 48;
export const SWIPE_DOMINANCE = 2;

export interface SwipeGuards {
  touchCount: number;
  horizontalScroller?: boolean;
  interactive?: boolean;
  selection?: boolean;
  overlay?: boolean;
}

interface SwipeStart extends SwipeGuards {
  phone: boolean;
  drawer: SwipeDrawer;
  onChat: boolean;
  x: number;
  width: number;
}

export interface SwipeState {
  direction: "pending" | "left" | "right" | "cancelled" | "complete";
  left: SwipeAction | null;
  right: SwipeAction | null;
}

interface SwipeResult {
  state: SwipeState;
  action: SwipeAction | null;
  preventDefault: boolean;
}

function blocked(guards: SwipeGuards) {
  return (
    guards.touchCount !== 1 ||
    guards.horizontalScroller ||
    guards.interactive ||
    guards.selection ||
    guards.overlay
  );
}

/** Ignore rules take precedence over edge navigation, even at a scroller's boundary. */
export function startSwipe(start: SwipeStart): SwipeState | null {
  if (!start.phone || blocked(start) || start.x < 0 || start.x > start.width) return null;
  const left = start.drawer === "sidebar" ? "close" : start.drawer === null ? "open-aside" : null;
  const right =
    start.drawer === "aside"
      ? "close"
      : start.drawer === null && (start.onChat || start.x <= SWIPE_EDGE)
        ? "open-sidebar"
        : null;
  return { direction: "pending", left, right };
}

/**
 * Lock to the first deliberate direction. Vertical/diagonal drags never become navigation later.
 * A completed gesture consumes the remaining horizontal drag but cannot run another action.
 */
export function advanceSwipe(
  state: SwipeState,
  move: SwipeGuards & { dx: number; dy: number },
): SwipeResult {
  const cancel = (): SwipeResult => ({
    state: { ...state, direction: "cancelled" },
    action: null,
    preventDefault: false,
  });
  if (blocked(move) || state.direction === "cancelled") return cancel();
  if (state.direction === "complete") return { state, action: null, preventDefault: true };

  const across = Math.abs(move.dx);
  const down = Math.abs(move.dy);
  let direction = state.direction;
  if (direction === "pending") {
    if (Math.max(across, down) < SWIPE_LOCK_DISTANCE) {
      return { state, action: null, preventDefault: false };
    }
    if (across < SWIPE_DOMINANCE * down) return cancel();
    direction = move.dx > 0 ? "right" : "left";
  }

  const action = state[direction];
  const distance = direction === "right" ? move.dx : -move.dx;
  if (!action || distance <= 0) return cancel();
  const complete = distance >= SWIPE_DISTANCE;
  return {
    state: { ...state, direction: complete ? "complete" : direction },
    action: complete ? action : null,
    preventDefault: true,
  };
}
