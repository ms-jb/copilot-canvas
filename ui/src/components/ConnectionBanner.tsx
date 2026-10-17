import { Button } from "@mantine/core";
import type { ConnectionPhase } from "../useConnection";
import classes from "./ConnectionBanner.module.css";

// Only real failures and states the user can act on. Connecting and brief reconnects are shown
// by the dot next to the assistant name, not here.
const MESSAGES: Partial<Record<ConnectionPhase, string>> = {
  disconnected: "Can't reach the session. Open the canvas in Copilot to reconnect.",
  stale: "The session restarted. Reload to reconnect.",
};

/**
 * An inline alert under the top bar for a lost connection or a restarted session. The live region
 * stays mounted so changes are announced.
 */
export function ConnectionBanner({ phase }: { phase: ConnectionPhase }) {
  const message = MESSAGES[phase];
  const stale = phase === "stale";
  return (
    <div role="status" aria-live="polite" className={classes.region}>
      {message && (
        <div className={classes.banner}>
          <span className={classes.dot} aria-hidden="true" />
          <span className={classes.message}>{message}</span>
          {stale && (
            <Button size="compact-sm" variant="default" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
