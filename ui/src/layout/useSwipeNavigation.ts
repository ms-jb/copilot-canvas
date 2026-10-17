import { useEffect, useEffectEvent, type RefObject } from "react";
import {
  advanceSwipe,
  startSwipe,
  type SwipeAction,
  type SwipeDrawer,
  type SwipeGuards,
  type SwipeState,
} from "./swipe";

const INPUTS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [data-no-swipe]';
const OVERLAYS =
  'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], .mantine-Popover-dropdown, .mantine-Combobox-dropdown';

function overlayOpen() {
  return [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some(
    (element) =>
      !element.hasAttribute("data-shell-drawer") &&
      !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

function horizontalScroller(from: Element) {
  for (let element: Element | null = from; element; element = element.parentElement) {
    if (
      element.scrollWidth > element.clientWidth &&
      /^(auto|scroll)$/.test(getComputedStyle(element).overflowX)
    ) {
      return true;
    }
  }
  return false;
}

function hasSelection() {
  if (window.getSelection()?.toString()) return true;
  const focused = document.activeElement;
  return (
    (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) &&
    focused.selectionStart !== focused.selectionEnd
  );
}

function guards(from: Element, touchCount: number): SwipeGuards {
  return {
    touchCount,
    interactive: Boolean(from.closest(INPUTS)),
    horizontalScroller: horizontalScroller(from),
    selection: hasSelection(),
    overlay: overlayOpen(),
  };
}

interface ActiveSwipe {
  id: number;
  x: number;
  y: number;
  from: Element;
  drawer: SwipeDrawer;
  state: SwipeState;
}

/**
 * Listen across the shell's portaled drawers, but only on a phone. Touch events keep arriving when
 * the browser starts scrolling; preventDefault is reserved for a locked, actionable horizontal drag.
 */
export function useSwipeNavigation(
  shell: RefObject<HTMLDivElement | null>,
  phone: boolean,
  drawer: SwipeDrawer,
  run: (action: SwipeAction) => void,
) {
  const currentDrawer = useEffectEvent(() => drawer);
  const act = useEffectEvent(run);

  useEffect(() => {
    if (!phone) return;
    let active: ActiveSwipe | null = null;

    const press = (event: TouchEvent) => {
      active = null;
      const touch = event.touches[0];
      const from = event.target;
      if (!touch || !(from instanceof Element)) return;
      const open = currentDrawer();
      const drawerElement = from.closest("[data-shell-drawer]");
      if (
        open
          ? drawerElement?.getAttribute("data-shell-drawer") !== open
          : !shell.current?.contains(from)
      ) {
        return;
      }
      const state = startSwipe({
        ...guards(from, event.touches.length),
        phone: true,
        drawer: open,
        onChat: Boolean(from.closest("[data-swipe-chat]")),
        x: touch.clientX,
        width: window.innerWidth,
      });
      if (state) {
        active = {
          id: touch.identifier,
          x: touch.clientX,
          y: touch.clientY,
          from,
          drawer: open,
          state,
        };
      }
    };

    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!active || !touch) return;
      if (
        event.touches.length !== 1 ||
        touch.identifier !== active.id ||
        (active.state.direction !== "complete" && active.drawer !== currentDrawer())
      ) {
        active = null;
        return;
      }
      const result = advanceSwipe(active.state, {
        ...guards(active.from, event.touches.length),
        dx: touch.clientX - active.x,
        dy: touch.clientY - active.y,
      });
      active.state = result.state;
      if (result.preventDefault && event.cancelable) event.preventDefault();
      if (result.action) act(result.action);
      if (result.state.direction === "cancelled") active = null;
    };

    const end = () => {
      active = null;
    };
    document.addEventListener("touchstart", press, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, { passive: true, capture: true });
    document.addEventListener("touchcancel", end, { passive: true, capture: true });
    return () => {
      document.removeEventListener("touchstart", press, true);
      document.removeEventListener("touchmove", move, true);
      document.removeEventListener("touchend", end, true);
      document.removeEventListener("touchcancel", end, true);
    };
  }, [phone, shell]);
}
