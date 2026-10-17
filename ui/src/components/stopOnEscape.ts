import { type RefObject, useEffect, useRef } from "react";

// An open overlay owns Escape even when it leaves the key unprevented (Mantine modals and menus
// listen on the window).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]';
const EXPANDED = '[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]';

export interface EscapeKey {
  key: string;
  defaultPrevented: boolean;
  repeat: boolean;
  isComposing: boolean;
  modified: boolean;
  /** The key came from inside the chat, or from no element in particular. */
  fromChat: boolean;
  /** Something else is open and owns Escape: an overlay or an expanded control. */
  overlayOpen: boolean;
}

/** One plain Escape press that nothing else has used. */
export function escapeStops(key: EscapeKey): boolean {
  return (
    key.key === "Escape" &&
    !key.defaultPrevented &&
    !key.repeat &&
    !key.isComposing &&
    !key.modified &&
    key.fromChat &&
    !key.overlayOpen
  );
}

/** Escape stops the running turn through the same call as the Stop button, once per press. */
export function useStopOnEscape(
  root: RefObject<HTMLElement | null>,
  stop: (() => void) | undefined,
) {
  const latest = useRef(stop);
  latest.current = stop;
  const active = stop !== undefined;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const chat = root.current;
      const target = event.target instanceof Element ? event.target : null;
      if (!chat || !latest.current) return;
      const stops = escapeStops({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        repeat: event.repeat,
        isComposing: event.isComposing || event.keyCode === 229,
        modified: event.ctrlKey || event.altKey || event.metaKey || event.shiftKey,
        fromChat: !target || target === document.body || chat.contains(target),
        overlayOpen: Boolean(target?.closest(EXPANDED) || document.querySelector(OVERLAY)),
      });
      if (!stops) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, root]);
}
