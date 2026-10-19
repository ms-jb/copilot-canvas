import { Alert, Button } from "@mantine/core";
import type { ConnectionPhase } from "../useConnection";
import classes from "./ConnectionBanner.module.css";

// Only real failures and states the user can act on. Connecting and brief reconnects are shown
// by the dot next to the assistant name, not here.
const MESSAGES: Partial<Record<ConnectionPhase, { color: string; title: string; text: string }>> = {
  offline: {
    color: "yellow",
    title: "You're offline",
    text: "Sending and answering are paused. Your draft is kept, and the canvas reconnects when your connection is back.",
  },
  disconnected: {
    color: "red",
    title: "Can't reach the session",
    text: "Open the canvas in Copilot to reconnect.",
  },
  stale: {
    color: "red",
    title: "The session restarted",
    text: "Reload to reconnect.",
  },
};

function OfflineIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.2A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 4-2.2M15 10.4a10 10 0 0 1 4 2.1M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />
    </svg>
  );
}

/**
 * An inline alert under the top bar for an offline device, a lost connection or a restarted
 * session. The live region stays mounted so changes are announced.
 */
export function ConnectionBanner({ phase }: { phase: ConnectionPhase }) {
  const message = MESSAGES[phase];
  return (
    <div role="status" aria-live="polite" className={classes.region}>
      {message && (
        <Alert
          className={classes.banner}
          variant="light"
          color={message.color}
          radius="sm"
          title={message.title}
          icon={phase === "offline" ? <OfflineIcon /> : undefined}
        >
          <div className={classes.body}>
            <span>{message.text}</span>
            {phase === "stale" && (
              <Button size="compact-sm" variant="default" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </div>
        </Alert>
      )}
    </div>
  );
}
