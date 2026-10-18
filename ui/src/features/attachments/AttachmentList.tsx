import { CloseButton, Group, Image, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { TranscriptAttachment } from "../../shared";
import type { DraftAttachment } from "./useAttachments";
import styles from "./Attachments.module.css";

function Item({
  name,
  preview,
  lazy,
  children,
}: {
  name: string;
  preview?: string;
  lazy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Paper component="li" withBorder radius="md" className={styles.item}>
      {preview && (
        <Image
          src={preview}
          alt={name}
          w={56}
          h={56}
          flex="none"
          fit="contain"
          loading={lazy ? "lazy" : undefined}
        />
      )}
      <Text span size="sm" className={styles.name}>
        {name}
      </Text>
      {children}
    </Paper>
  );
}

export function AttachmentList({ attachments }: { attachments: TranscriptAttachment[] }) {
  return (
    <Group component="ul" gap="xs" className={styles.list} aria-label="Message attachments">
      {attachments.map((attachment, index) => (
        <Item
          key={`${index}:${attachment.name}`}
          name={attachment.name}
          lazy
          preview={
            attachment.preview &&
            `data:${attachment.preview.mimeType};base64,${attachment.preview.data}`
          }
        />
      ))}
    </Group>
  );
}

export function DraftAttachments({
  items,
  disabled,
  onRemove,
}: {
  items: DraftAttachment[];
  disabled: boolean;
  onRemove: (id: number) => void;
}) {
  return (
    <Group
      component="ul"
      gap="xs"
      className={styles.list}
      aria-label="Attachments for next message"
    >
      {items.map(({ id, file }) => (
        <Item
          key={id}
          name={file.name}
          preview={
            file.mimeType.startsWith("image/")
              ? `data:${file.mimeType};base64,${file.data}`
              : undefined
          }
        >
          <CloseButton
            size={44}
            iconSize={18}
            aria-label={`Remove ${file.name}`}
            title={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(id)}
          />
        </Item>
      ))}
    </Group>
  );
}
