import { MarkdownView } from "../MarkdownView";
import { AlertIcon } from "./ChatIcons";
import styles from "./Message.module.css";
import { Timestamp } from "./Timestamp";

interface UserMessageProps {
  text: string;
  timestamp: string;
  /** Delivery note for an optimistic message the transcript has not confirmed yet. */
  pendingLabel?: string;
}

export function UserMessage({ text, timestamp, pendingLabel }: UserMessageProps) {
  return (
    <article
      className={styles.user}
      aria-label="You"
      data-pending={pendingLabel ? "true" : undefined}
    >
      <div className={styles.bubble}>{text}</div>
      <div className={styles.meta}>
        {pendingLabel ? (
          <span className={styles.pending}>{pendingLabel}</span>
        ) : (
          <Timestamp value={timestamp} />
        )}
      </div>
    </article>
  );
}

interface AssistantMessageProps {
  text: string;
  timestamp: string;
  streaming?: boolean;
  assistantName: string;
}

export function AssistantMessage({
  text,
  timestamp,
  streaming,
  assistantName,
}: AssistantMessageProps) {
  return (
    <article
      className={styles.assistant}
      aria-label={assistantName}
      aria-busy={streaming || undefined}
    >
      <header className={styles.header}>
        <Avatar name={assistantName} />
        <span className={styles.author}>{assistantName}</span>
        <Timestamp value={timestamp} />
      </header>
      <div className={styles.body}>
        <MarkdownView text={text} streaming={streaming} />
      </div>
    </article>
  );
}

export function ErrorMessage({ text, timestamp }: { text: string; timestamp: string }) {
  return (
    <div className={styles.error} role="note" aria-label="Error">
      <span className={styles.errorIcon}>
        <AlertIcon size={16} />
      </span>
      <div className={styles.errorBody}>
        <div className={styles.errorHead}>
          <span className={styles.errorTitle}>Error</span>
          <Timestamp value={timestamp} />
        </div>
        <div className={styles.errorText}>{text}</div>
      </div>
    </div>
  );
}

/** First letter of the assistant name in a small accent-tinted circle. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span className={styles.avatar} data-size={size} aria-hidden="true">
      {initial}
    </span>
  );
}
