import { Alert, Button, Group } from "@mantine/core";
import type { ConnectionPhase } from "../useConnection";

const MESSAGES: Record<Exclude<ConnectionPhase, "connected">, string> = {
  bootstrapping: "Connecting…",
  connecting: "Connecting…",
  reconnecting: "Connection lost — reconnecting…",
  disconnected: "Not connected to the session. Retrying…",
  stale: "Provider restarted — reload this panel to reconnect.",
};

/** Shows nothing while connected; otherwise explains the connection state. */
export function ConnectionBanner({ phase }: { phase: ConnectionPhase }) {
  if (phase === "connected") return null;
  const stale = phase === "stale";
  const pending = phase === "bootstrapping" || phase === "connecting";
  return (
    <Alert
      className="connection-banner"
      role="status"
      color={stale ? "red" : pending ? "blue" : "yellow"}
      variant="light"
      radius={0}
      py="xs"
    >
      <Group justify="space-between" gap="sm" wrap="wrap">
        <span>{MESSAGES[phase]}</span>
        {stale && (
          <Button size="xs" onClick={() => window.location.reload()}>
            Reload
          </Button>
        )}
      </Group>
    </Alert>
  );
}
