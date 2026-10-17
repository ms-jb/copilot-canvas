import { Badge, Loader } from "@mantine/core";
import type { SessionStatus } from "../shared";

export function StatusChip({ status }: { status: SessionStatus }) {
  if (status.phase === "waiting") {
    return (
      <Badge
        role="status"
        color="yellow"
        variant="light"
        size="lg"
        className="status-chip"
        styles={{ label: { whiteSpace: "normal", overflow: "visible" } }}
      >
        Waiting for you — answer the prompt in the Copilot app
      </Badge>
    );
  }
  if (status.phase === "working") {
    return (
      <Badge
        role="status"
        color="blue"
        variant="light"
        size="lg"
        className="status-chip"
        leftSection={<Loader size={12} type="dots" />}
      >
        Working
      </Badge>
    );
  }
  return (
    <Badge role="status" color="gray" variant="light" size="lg" className="status-chip">
      Idle
    </Badge>
  );
}
