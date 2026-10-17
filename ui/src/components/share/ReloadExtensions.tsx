import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { requestReload } from "../../api";
import { IconButton } from "../../layout/IconButton";
import type { Connection } from "../../useConnection";
import { ReloadIcon } from "../../views/icons";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

// The gateway never forwards a reload, so the button lives only where the provider is served directly.
const isLoopback = () => ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

/**
 * Reloads this session's extensions so a rebuilt canvas takes effect without restarting Copilot.
 * Always behind a confirm; the canvas goes away with the old extension and is reopened from Copilot.
 */
export function ReloadExtensions({ connection }: { connection: Connection }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const context = connection.context;
  if (!context || !isLoopback()) return null;

  const confirm = async () => {
    setState({ kind: "busy" });
    const outcome = await requestReload(context);
    if (outcome.kind === "scheduled") setState({ kind: "done" });
    else if (outcome.kind === "stale") connection.markStale();
    else setState({ kind: "failed", message: outcome.message });
  };
  const dismiss = () => {
    close();
    if (state.kind !== "busy") setState({ kind: "idle" });
  };

  return (
    <>
      <IconButton label="Reload extensions" onClick={open}>
        <ReloadIcon />
      </IconButton>
      <Modal opened={opened} onClose={dismiss} title="Reload extensions" centered size="sm">
        <Stack gap="md">
          <Text size="sm">
            {state.kind === "done"
              ? "Reloading. This canvas closes with the old extension; open it again from Copilot to see your changes."
              : "Restart this session's extensions so a rebuilt canvas takes effect. Your conversation is kept; other sessions are not affected."}
          </Text>
          {state.kind === "failed" && (
            <Text size="sm" c="red" role="alert">
              {state.message}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={dismiss}>
              {state.kind === "done" ? "Close" : "Cancel"}
            </Button>
            {state.kind !== "done" && (
              <Button size="xs" loading={state.kind === "busy"} onClick={() => void confirm()}>
                Reload
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
