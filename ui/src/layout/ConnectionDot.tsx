import type { ConnectionPhase } from "../useConnection";
import classes from "./ConnectionDot.module.css";

type Tone = "success" | "pending" | "warning" | "danger";

const STATES: Record<ConnectionPhase, { label: string; tone: Tone }> = {
  bootstrapping: { label: "Connecting", tone: "pending" },
  connecting: { label: "Connecting", tone: "pending" },
  connected: { label: "Connected", tone: "success" },
  reconnecting: { label: "Reconnecting", tone: "warning" },
  disconnected: { label: "Not connected", tone: "danger" },
  stale: { label: "Needs reload", tone: "danger" },
  offline: { label: "Offline", tone: "danger" },
};

/** The single home of connection health: a dot next to the assistant name, labelled on hover. */
export function ConnectionDot({ phase }: { phase: ConnectionPhase }) {
  const { label, tone } = STATES[phase];
  return (
    <span className={classes.root} title={label}>
      <span className={classes.dot} data-tone={tone} aria-hidden="true" />
      <span className={classes.visuallyHidden}>{label}</span>
    </span>
  );
}
