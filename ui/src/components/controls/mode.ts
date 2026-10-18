import { SESSION_MODES, type SessionMode } from "../../shared";

/** Plan reads blue and Autopilot green at a glance; Interactive stays neutral. The name says which. */
export const MODE_COLORS: Readonly<Record<SessionMode, "gray" | "blue" | "green">> = {
  interactive: "gray",
  plan: "blue",
  autopilot: "green",
};

/** The mode after `current` in the Copilot app's Shift+Tab order, wrapping around; null if unknown. */
export function nextMode(current: string | undefined): SessionMode | null {
  const at = SESSION_MODES.findIndex((mode) => mode === current);
  return at < 0 ? null : (SESSION_MODES[(at + 1) % SESSION_MODES.length] ?? null);
}

/** Shift+Tab alone: any other modifier, or an open IME composition, keeps the key's usual meaning. */
export function cyclesMode(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}): boolean {
  return (
    event.key === "Tab" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing
  );
}
