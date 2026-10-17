import { AttachmentList } from "../features/attachments/AttachmentList";
import type { PendingMessage } from "./Transcript";
import styles from "./QueuedMessages.module.css";

export function QueuedMessages({ messages }: { messages: PendingMessage[] }) {
  if (!messages.length) return null;
  return (
    <section className={styles.queue} aria-label="Queued messages" aria-live="polite">
      <div className={styles.heading}>Queue · {messages.length}</div>
      <ol className={styles.list}>
        {messages.map((message) => (
          <li className={styles.item} key={message.requestId}>
            <span className={styles.label}>
              {message.state === "sending" ? "Adding to queue…" : "Queued"}
            </span>
            {message.text && <div className={styles.text}>{message.text}</div>}
            {message.attachments?.length ? (
              <AttachmentList attachments={message.attachments} />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
