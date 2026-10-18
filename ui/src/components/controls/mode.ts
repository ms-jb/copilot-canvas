import { SESSION_MODES, type SessionMode } from "../../shared";

/** Plan reads blue and Autopilot green at a glance; Interactive stays neutral. The name says which. */
export const MODE_COLORS: Readonly<Record<SessionMode, "gray" | "blue" | "green">> = {
  interactive: "gray",
  plan: "blue",
  autopilot: "green",
};

/** The mode after `current` in the Copilot app's chip's order, wrapping around; null if unknown. */
export function nextMode(current: string | undefined): SessionMode | null {
  const at = SESSION_MODES.findIndex((mode) => mode === current);
  return at < 0 ? null : (SESSION_MODES[(at + 1) % SESSION_MODES.length] ?? null);
}

/**
 * Alt+M alone: any other modifier, or an open IME composition, keeps the key's usual meaning. Matches
 * the physical key because Option+M on macOS types a different character.
 */
export function cyclesMode(event: {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}): boolean {
  return (
    event.code === "KeyM" &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

/** Cycles the mode on Alt+M and claims the key only then; the field's draft and caret are never touched. */
export function handleModeShortcut(
  event: Parameters<typeof cyclesMode>[0] & { preventDefault: () => void },
  cycleMode: () => boolean,
): void {
  if (cyclesMode(event) && cycleMode()) event.preventDefault();
}
