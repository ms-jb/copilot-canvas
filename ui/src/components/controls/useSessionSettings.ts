import { useCallback } from "react";
import type { ControlChange, SessionControls as Controls, SessionMode } from "../../shared";
import type { Connection } from "../../useConnection";
import { nextMode } from "./mode";
import { useControlChange, type ControlChangeState } from "./useControlChange";

export interface SessionSettings {
  live: Controls;
  /** What to show: the live values with any change in flight or waiting for the turn laid over them. */
  controls: Controls;
  /** The change in flight or waiting, if any. */
  requested: ControlChange | null;
  error: string | null;
  /** Offline: every setting is read-only. */
  disabled: boolean;
  /** The mode to show, or undefined when the host can't report one. */
  mode: SessionMode | undefined;
  apply: ControlChangeState["apply"];
  /** Moves to the next mode (Alt+M); false when there is no known mode to move from. */
  cycleMode: () => boolean;
}

/**
 * The composer's session settings in one place, so the mode chip, the settings panel, the
 * mode-colored border and Alt+M all read and change the same state.
 */
export function useSessionSettings(connection: Connection): SessionSettings {
  const { pending, deferred, error, apply } = useControlChange(connection);
  const live = connection.view.controls;
  const requested = pending ?? deferred;
  const controls = requested ? ({ ...live, ...requested } as Controls) : live;
  const mode = live.available.mode ? controls.mode : undefined;
  const disabled = connection.phase !== "connected" || connection.context === null;
  const cycleMode = useCallback(() => {
    const next = !disabled ? nextMode(mode) : null;
    if (next === null) return false;
    apply({ mode: next });
    return true;
  }, [apply, disabled, mode]);
  return { live, controls, requested, error, disabled, mode, apply, cycleMode };
}
