import { Loader, Textarea } from "@mantine/core";
import { useRef, type KeyboardEvent, type Ref } from "react";
import { LIMITS, type SendMode } from "../shared";
import type { Connection } from "../useConnection";
import { AlertIcon } from "./ChatIcons";
import { SendButton } from "./SendButton";
import { SessionControls } from "./controls/SessionControls";
import styles from "./Composer.module.css";
import { ATTACHMENT_ACCEPT, clipboardFiles } from "../features/attachments/files";
import { DraftAttachments } from "../features/attachments/AttachmentList";
import type { useAttachments } from "../features/attachments/useAttachments";

export interface ComposerNotice {
  kind: "error" | "uncertain";
  message: string;
}

interface ComposerProps {
  connection: Connection;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (mode: SendMode) => void;
  busy: boolean;
  /** Disabled while not connected; the connection banner explains why when it matters. */
  disabled: boolean;
  notice: ComposerNotice | null;
  assistantName: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Set while a turn is running: an empty composer offers Stop instead of Send. */
  onStop?: () => void;
  stopping?: boolean;
  attachments: ReturnType<typeof useAttachments>;
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
  onStop,
  stopping = false,
  attachments,
}: ComposerProps) {
  const picker = useRef<HTMLInputElement>(null);
  const hasContent = value.trim().length > 0 || attachments.items.length > 0;
  const canSend = !disabled && !busy && !attachments.reading && hasContent;
  const showStop = onStop !== undefined && !busy && !hasContent;
  const attachmentsDisabled = disabled || busy || attachments.reading;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline; never fire while an IME is composing.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat && canSend) onSubmit(event.altKey ? "enqueue" : "immediate");
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit("immediate");
      }}
    >
      <div className={styles.card} data-disabled={disabled ? "true" : undefined}>
        {attachments.items.length > 0 && (
          <DraftAttachments
            items={attachments.items}
            disabled={attachmentsDisabled}
            onRemove={(id) => attachments.remove([id])}
          />
        )}
        {attachments.error && (
          <div className={styles.notice} data-kind="error" role="alert">
            {attachments.error}
          </div>
        )}
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
          onPaste={(event) => {
            const files = clipboardFiles(event.clipboardData);
            if (files.length === 0) return;
            // Preserve ordinary text in a mixed clipboard; never replace it with image markup.
            if (!event.clipboardData.getData("text/plain")) event.preventDefault();
            if (!attachmentsDisabled) void attachments.add(files);
          }}
          enterKeyHint="send"
          autoComplete="off"
        />
        <div className={styles.footer}>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            accept={ATTACHMENT_ACCEPT}
            disabled={attachmentsDisabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (!attachmentsDisabled) void attachments.add(files);
            }}
          />
          <button
            type="button"
            className={styles.attach}
            disabled={attachmentsDisabled}
            aria-label={attachments.reading ? "Reading attachments" : "Attach files"}
            title="Attach images, PDF or text files"
            onClick={() => picker.current?.click()}
          >
            {attachments.reading ? (
              <Loader size={16} color="currentColor" />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
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
          <SendButton
            canSend={canSend}
            busy={busy}
            disabled={disabled}
            showStop={showStop}
            stopping={stopping}
            onStop={onStop}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </form>
  );
}
