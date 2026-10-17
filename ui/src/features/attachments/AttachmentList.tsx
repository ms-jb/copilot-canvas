import type { TranscriptAttachment } from "../../shared";
import type { DraftAttachment } from "./useAttachments";
import styles from "./Attachments.module.css";

export function AttachmentList({ attachments }: { attachments: TranscriptAttachment[] }) {
  return (
    <ul className={styles.list} aria-label="Message attachments">
      {attachments.map((attachment, index) => (
        <li className={styles.item} key={`${index}:${attachment.name}`}>
          {attachment.preview && (
            <img
              className={styles.preview}
              src={`data:${attachment.preview.mimeType};base64,${attachment.preview.data}`}
              alt={attachment.name}
              loading="lazy"
            />
          )}
          <span className={styles.name}>{attachment.name}</span>
        </li>
      ))}
    </ul>
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
    <ul className={styles.list} aria-label="Attachments for next message">
      {items.map(({ id, file }) => (
        <li className={styles.item} key={id}>
          {file.mimeType.startsWith("image/") && (
            <img
              className={styles.preview}
              src={`data:${file.mimeType};base64,${file.data}`}
              alt={file.name}
            />
          )}
          <span className={styles.name}>{file.name}</span>
          <button
            type="button"
            className={styles.remove}
            aria-label={`Remove ${file.name}`}
            title={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
