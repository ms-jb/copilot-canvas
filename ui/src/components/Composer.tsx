import { Alert, Button, Text, Textarea } from "@mantine/core";
import type { KeyboardEvent } from "react";
import { LIMITS } from "../shared";

export interface ComposerNotice {
  kind: "error" | "uncertain";
  message: string;
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** When set the composer is disabled and this explains why. */
  disabledReason?: string;
  notice: ComposerNotice | null;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  disabledReason,
  notice,
}: ComposerProps) {
  const disabled = disabledReason !== undefined;
  const canSend = !disabled && !busy && value.trim().length > 0;
  const nearLimit = value.length > LIMITS.maxPromptChars * 0.9;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline; never fire while an IME is composing.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat && canSend) onSubmit();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      {notice && (
        <Alert
          role="alert"
          color={notice.kind === "uncertain" ? "yellow" : "red"}
          variant="light"
          py="xs"
          mb="xs"
        >
          {notice.message}
        </Alert>
      )}
      {disabledReason && (
        <Text size="sm" c="dimmed" mb="xs">
          {disabledReason}
        </Text>
      )}
      <div className="composer-row">
        <Textarea
          className="composer-input"
          aria-label="Message to Copilot"
          placeholder="Message Copilot…"
          autosize
          minRows={1}
          maxRows={8}
          maxLength={LIMITS.maxPromptChars}
          value={value}
          readOnly={busy}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" className="composer-send" disabled={!canSend} loading={busy}>
          Send
        </Button>
      </div>
      {nearLimit && (
        <Text size="xs" c="dimmed" ta="right" mt={4}>
          {value.length} / {LIMITS.maxPromptChars}
        </Text>
      )}
    </form>
  );
}
