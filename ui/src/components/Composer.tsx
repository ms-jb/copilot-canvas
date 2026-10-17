import { Loader, Textarea } from "@mantine/core";
import type { KeyboardEvent, Ref } from "react";
import { LIMITS } from "../shared";
import type { Connection } from "../useConnection";
import { AlertIcon, SendIcon } from "./ChatIcons";
import { SessionControls } from "./controls/SessionControls";
import styles from "./Composer.module.css";

export interface ComposerNotice {
  kind: "error" | "uncertain";
  message: string;
}

interface ComposerProps {
  connection: Connection;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Disabled while not connected; the connection banner explains why when it matters. */
  disabled: boolean;
  notice: ComposerNotice | null;
  assistantName: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}

// Show the counter only when the limit is close enough to matter.
const COUNTER_FROM = Math.floor(LIMITS.maxPromptChars * 0.9);

export function Composer({
  connection,
  value,
  onChange,
  onSubmit,
  busy,
  disabled,
  notice,
  assistantName,
  inputRef,
}: ComposerProps) {
  const canSend = !disabled && !busy && value.trim().length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline; never fire while an IME is composing.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat && canSend) onSubmit();
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <div className={styles.card} data-disabled={disabled ? "true" : undefined}>
        {notice && (
          <div className={styles.notice} data-kind={notice.kind} role="alert">
            <span className={styles.noticeIcon}>
              <AlertIcon size={14} />
            </span>
            <span>{notice.message}</span>
          </div>
        )}
        <Textarea
          ref={inputRef}
          variant="unstyled"
          classNames={{ root: styles.field, input: styles.input }}
          aria-label={`Message ${assistantName}`}
          placeholder={`Message ${assistantName}…`}
          autosize
          minRows={1}
          maxRows={10}
          maxLength={LIMITS.maxPromptChars}
          value={value}
          readOnly={busy}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          autoComplete="off"
        />
        <div className={styles.footer}>
          <div className={styles.controls}>
            <SessionControls connection={connection} />
          </div>
          {value.length >= COUNTER_FROM && (
            <span
              className={styles.counter}
              data-full={value.length >= LIMITS.maxPromptChars ? "true" : undefined}
            >
              {value.length.toLocaleString()} / {LIMITS.maxPromptChars.toLocaleString()}
            </span>
          )}
          <button
            type="submit"
            className={styles.send}
            disabled={!canSend}
            aria-label={busy ? "Sending" : "Send message"}
            title="Send (Enter)"
          >
            {busy ? <Loader size={14} color="currentColor" /> : <SendIcon size={16} />}
          </button>
        </div>
      </div>
    </form>
  );
}
