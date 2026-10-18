import { useState } from "react";
import { ActionIcon, Button, Group, Paper, Text, Textarea } from "@mantine/core";
import { QUEUE_LIMITS, type QueueChange, type QueueItem } from "../shared";
import { AttachmentList } from "../features/attachments/AttachmentList";
import type { PendingMessage } from "./Transcript";
import styles from "./QueuedMessages.module.css";

/** A message waiting for its turn: the host's queue item, or a send this page hasn't seen listed yet. */
export type QueueRow =
  | { kind: "item"; item: QueueItem }
  | { kind: "local"; message: PendingMessage };

/** Host items first, in the session's order; this page's own sends appear until the host lists them. */
export function queueRows(items: QueueItem[] = [], local: PendingMessage[]): QueueRow[] {
  const listed = new Set(items.flatMap((item) => (item.requestId ? [item.requestId] : [])));
  return [
    ...items.map((item): QueueRow => ({ kind: "item", item })),
    ...local
      .filter((message) => !listed.has(message.requestId))
      .map((message): QueueRow => ({ kind: "local", message })),
  ];
}

interface QueuedMessagesProps {
  rows: QueueRow[];
  /** Resolves with an error message when the change did not apply. */
  onChange: (change: QueueChange) => Promise<string | null>;
  disabled?: boolean;
}

export function QueuedMessages({ rows, onChange, disabled }: QueuedMessagesProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  if (!rows.length) return null;
  const itemCount = rows.filter((row) => row.kind === "item").length;

  const apply = async (change: QueueChange) => {
    if (working) return false;
    setWorking(true);
    setError(null);
    const failure = await onChange(change);
    setError(failure);
    setWorking(false);
    return failure === null;
  };
  const save = async () => {
    if (!editing?.text.trim()) return;
    if (await apply({ action: "edit", id: editing.id, text: editing.text })) setEditing(null);
  };

  return (
    <Paper
      component="section"
      withBorder
      radius="md"
      px="sm"
      py="xs"
      my="xs"
      className={styles.queue}
      aria-label="Queued messages"
      aria-live="polite"
    >
      <Text size="xs" fw={600} c="dimmed">
        Queued ({rows.length})
      </Text>
      <ol className={styles.list}>
        {rows.map((row, index) => {
          if (row.kind === "local") {
            const { message } = row;
            return (
              <li className={styles.item} key={message.requestId}>
                <Text size="xs" c="dimmed">
                  {message.state === "sending" ? "Adding to queue…" : "Queued"}
                </Text>
                {message.text && (
                  <Text size="sm" className={styles.text}>
                    {message.text}
                  </Text>
                )}
                {message.attachments?.length ? (
                  <AttachmentList attachments={message.attachments} />
                ) : null}
              </li>
            );
          }
          const { item } = row;
          const isEditing = editing?.id === item.id;
          const locked = disabled || working;
          return (
            <li className={styles.item} key={item.id}>
              {isEditing ? (
                <>
                  <Textarea
                    autosize
                    minRows={1}
                    maxRows={6}
                    maxLength={QUEUE_LIMITS.maxTextChars}
                    size="xs"
                    aria-label="Queued message text"
                    value={editing.text}
                    onChange={(event) =>
                      setEditing({ id: item.id, text: event.currentTarget.value })
                    }
                  />
                  <Group gap="xs" mt={4}>
                    <Button
                      size="compact-xs"
                      onClick={() => void save()}
                      disabled={locked || !editing.text.trim()}
                    >
                      Save
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </Group>
                </>
              ) : (
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Text size="sm" className={styles.text} flex={1}>
                    {item.text}
                  </Text>
                  <Group gap={2} wrap="nowrap">
                    {item.kind === "message" && (
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="Edit queued message"
                        disabled={locked || item.truncated}
                        title={
                          item.truncated ? "Edit this long message in the Copilot app" : undefined
                        }
                        onClick={() => setEditing({ id: item.id, text: item.text })}
                      >
                        ✎
                      </ActionIcon>
                    )}
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      aria-label="Move queued message up"
                      disabled={locked || index === 0}
                      onClick={() =>
                        void apply({ action: "move", id: item.id, toPosition: index - 1 })
                      }
                    >
                      ↑
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      aria-label="Move queued message down"
                      disabled={locked || index >= itemCount - 1}
                      onClick={() =>
                        void apply({ action: "move", id: item.id, toPosition: index + 1 })
                      }
                    >
                      ↓
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label="Remove queued message"
                      disabled={locked}
                      onClick={() => void apply({ action: "remove", id: item.id })}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                </Group>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
    </Paper>
  );
}
