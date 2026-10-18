import { Alert, Avatar as MantineAvatar, Box, Group, Paper, Text } from "@mantine/core";
import { MarkdownView } from "../MarkdownView";
import { AlertIcon } from "./ChatIcons";
import styles from "./Message.module.css";
import { Timestamp } from "./Timestamp";
import { AttachmentList } from "../features/attachments/AttachmentList";
import type { TranscriptAttachment } from "../shared";

interface UserMessageProps {
  text: string;
  timestamp: string;
  /** Delivery note for an optimistic message the transcript has not confirmed yet. */
  pendingLabel?: string;
  /** Follows another turn of yours, so it sits closer to it. */
  continued?: boolean;
  /** Last of a run of your turns: shows the run's time below it. */
  endsRun?: boolean;
  attachments?: TranscriptAttachment[];
}

export function UserMessage({
  text,
  timestamp,
  pendingLabel,
  continued,
  endsRun = true,
  attachments,
}: UserMessageProps) {
  return (
    <article
      className={styles.user}
      aria-label="You"
      data-pending={pendingLabel ? "true" : undefined}
      data-continued={continued || undefined}
    >
      <Paper withBorder radius="lg" px="sm" py="xs" className={styles.bubble}>
        {text}
        {attachments && attachments.length > 0 && <AttachmentList attachments={attachments} />}
      </Paper>
      {(pendingLabel || endsRun) && (
        <Group gap={0} px={4} mih={16}>
          {pendingLabel ? (
            <Text span size="xs" c="var(--cc-text-faint)">
              {pendingLabel}
            </Text>
          ) : (
            <Timestamp value={timestamp} />
          )}
        </Group>
      )}
    </article>
  );
}

interface AssistantMessageProps {
  text: string;
  timestamp: string;
  streaming?: boolean;
  assistantName: string;
  /** Follows another assistant turn, so it skips the avatar and name. */
  continued?: boolean;
  /** Last of a run of assistant turns: shows the run's time below it once it has finished. */
  endsRun?: boolean;
}

export function AssistantMessage({
  text,
  timestamp,
  streaming,
  assistantName,
  continued,
  endsRun = true,
}: AssistantMessageProps) {
  return (
    <article
      className={styles.assistant}
      aria-label={assistantName}
      aria-busy={streaming || undefined}
      data-continued={continued || undefined}
    >
      {!continued && (
        <Group gap="xs" mih={28} wrap="nowrap">
          <Avatar name={assistantName} />
          <Text span size="sm" fw={600}>
            {assistantName}
          </Text>
        </Group>
      )}
      <Box className={styles.body}>
        <MarkdownView text={text} streaming={streaming} />
        {endsRun && !streaming && <Timestamp value={timestamp} className={styles.time} />}
      </Box>
    </article>
  );
}

export function ErrorMessage({ text, timestamp }: { text: string; timestamp: string }) {
  return (
    <Alert
      // A past error in the log, not a live interruption.
      role="note"
      aria-label="Error"
      variant="light"
      color="red"
      radius="md"
      py="xs"
      px="sm"
      className={styles.error}
      icon={<AlertIcon size={16} />}
      title={
        <Group component="span" gap="xs" align="baseline">
          Error
          <Timestamp value={timestamp} />
        </Group>
      }
    >
      <Text size="sm" className={styles.errorText}>
        {text}
      </Text>
    </Alert>
  );
}

/** A neutral author initial, independent of personal branding. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <MantineAvatar
      alt=""
      size={size === "lg" ? 40 : 28}
      radius="xl"
      color="accent"
      variant="light"
      classNames={{ placeholder: styles.avatarInitial }}
      data-size={size}
      aria-hidden="true"
    >
      {initial}
    </MantineAvatar>
  );
}
