import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { requestReload } from "../../api";
import { IconButton } from "../../layout/IconButton";
import { isRemote } from "../../remote";
import type { Connection } from "../../useConnection";
import { ReloadIcon } from "../../views/icons";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/**
 * Reloads this session's extensions so a rebuilt canvas takes effect without restarting Copilot.
 * On the phone it also offers a page refresh, since an installed app has no reload button.
 * Always behind a confirm; the canvas goes away with the old extension and is reopened from Copilot.
 */
export function ReloadExtensions({ connection }: { connection: Connection }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const context = connection.context;
  const remote = isRemote();
  if (!context && !remote) return null;

  const confirm = async () => {
    if (!context) return;
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

  const explanation =
    state.kind === "done"
      ? remote
        ? "Reloading. This phone disconnects until the canvas is open again in Copilot on your computer; then refresh here."
        : "Reloading. This canvas closes with the old extension; open it again from Copilot to see your changes."
      : remote
        ? "Refresh this page to pick up the latest canvas, or reload the session's extensions after a rebuild. Reloading disconnects this phone until the canvas is open again on your computer."
        : "Restart this session's extensions so a rebuilt canvas takes effect. Your conversation is kept; other sessions are not affected.";

  return (
    <>
      <IconButton label={remote ? "Restart" : "Reload extensions"} onClick={open}>
        <ReloadIcon />
      </IconButton>
      <Modal
        opened={opened}
        onClose={dismiss}
        title={remote ? "Restart" : "Reload extensions"}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">{explanation}</Text>
          {state.kind === "failed" && (
            <Text size="sm" c="red" role="alert">
              {state.message}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={dismiss}>
              {state.kind === "done" ? "Close" : "Cancel"}
            </Button>
            {remote && (
              <Button variant="light" size="xs" onClick={() => window.location.reload()}>
                Refresh page
              </Button>
            )}
            {state.kind !== "done" && context && (
              <Button size="xs" loading={state.kind === "busy"} onClick={() => void confirm()}>
                Reload extensions
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
