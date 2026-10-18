import { Alert, Box, Group, Paper, Text, Textarea } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { LIMITS, type SendMode } from "../shared";
import type { Connection } from "../useConnection";
import { AlertIcon } from "./ChatIcons";
import { SendButton } from "./SendButton";
import { useTouchSize } from "./touchSize";
import { composerFit } from "./composerFit";
import { ComposerTools } from "./ComposerTools";
import { ModeChip } from "./controls/ModeChip";
import { handleModeShortcut } from "./controls/mode";
import { SessionControls } from "./controls/SessionControls";
import { useSessionSettings } from "./controls/useSessionSettings";
import styles from "./Composer.module.css";
import { clipboardFiles } from "../features/attachments/files";
import { DraftAttachments } from "../features/attachments/AttachmentList";
import type { useAttachments } from "../features/attachments/useAttachments";
import { queuesOnEnter } from "./sendPress";
import { MicButton } from "../features/dictation/MicButton";
import { useDictation } from "../features/dictation/useDictation";
import { appendDictation, editWithInterim, withInterim } from "../features/dictation/model";
import { ContextUsageIndicator } from "../features/context/ContextUsageIndicator";
import { SkillPicker } from "../features/skills/SkillPicker";
import { useSkillPicker } from "../features/skills/useSkillPicker";

export interface ComposerNotice {
  kind: "error" | "uncertain";
  message: string;
}

interface ComposerProps {
  connection: Connection;
  value: string;
  onChange: (value: string) => void;
  /** `text` is the draft to send when dictation just added its last words to it. */
  onSubmit: (mode: SendMode, text?: string) => void;
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
  /** Receives dictated text; the caller appends it to the draft. */
  onDictation: (text: string) => void;
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
  onDictation,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldRef = useMergedRef(field, inputRef);
  const mirror = useRef<HTMLDivElement>(null);
  const size = useTouchSize();
  const settings = useSessionSettings(connection);
  const { ref: cardRef, width: cardWidth } = useElementSize<HTMLDivElement>();
  const fit = composerFit(cardWidth);
  const dictation = useDictation({
    onText: onDictation,
    enabled: !disabled && !busy,
  });
  // Words heard but not final yet follow the draft, dimmed; they count as content so Send works.
  const { shown, interim } = withInterim(value, dictation.state.interim);
  const hasContent = shown.trim().length > 0 || attachments.items.length > 0;
  const canSend = !disabled && !busy && !attachments.reading && hasContent;
  const showStop = onStop !== undefined && !busy && !hasContent;
  const attachmentsDisabled = disabled || busy || attachments.reading;
  const skills = useSkillPicker({
    text: value,
    onChange,
    enabled: !disabled && !busy && !interim,
    sessionId: disabled ? undefined : connection.context?.sessionId,
    field,
  });

  // Keep the newest words in view, in the field and in the dimmed copy painted under it.
  useLayoutEffect(() => {
    const input = field.current;
    if (!interim || !input) return;
    input.scrollTop = input.scrollHeight;
    if (mirror.current) mirror.current.scrollTop = input.scrollTop;
  }, [shown, interim]);

  // Sending ends dictation; the words still interim go with the message.
  const submit = (mode: SendMode) => {
    const text = appendDictation(value, dictation.finishForSend());
    if (text !== value) onChange(text);
    onSubmit(mode, text);
  };

  const edit = (next: string) => {
    const { draft, absorbed } = editWithInterim(next, interim);
    if (absorbed) dictation.absorbInterim();
    onChange(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (skills.onKeyDown(event)) return;
    // Enter sends, Ctrl/Cmd/Alt+Enter queues, Shift+Enter inserts a newline; never fire while an
    // IME is composing.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat && canSend) submit(queuesOnEnter(event) ? "enqueue" : "immediate");
  };

  // Alt+M steps through the modes from anywhere in the composer; Tab and Shift+Tab stay native.
  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) =>
    handleModeShortcut(
      {
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        isComposing: event.nativeEvent.isComposing,
        preventDefault: () => event.preventDefault(),
      },
      settings.cycleMode,
    );

  return (
    <form
      className={styles.composer}
      onKeyDown={onFormKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) submit("immediate");
      }}
    >
      <SkillPicker picker={skills}>
        <Paper
          withBorder
          radius="lg"
          shadow={disabled ? undefined : "sm"}
          ref={cardRef}
          className={styles.card}
          data-composer-fit={fit}
          data-disabled={disabled || undefined}
          data-mode={settings.mode}
        >
          {attachments.items.length > 0 && (
            <DraftAttachments
              items={attachments.items}
              disabled={attachmentsDisabled}
              onRemove={(id) => attachments.remove([id])}
            />
          )}
          {attachments.error && <Notice kind="error">{attachments.error}</Notice>}
          {dictation.state.problem && (
            <Notice kind="error" onDismiss={dictation.dismiss}>
              {dictation.state.problem}
            </Notice>
          )}
          {settings.error && <Notice kind="error">{settings.error}</Notice>}
          {notice && <Notice kind={notice.kind}>{notice.message}</Notice>}
          <Textarea
            ref={fieldRef}
            variant="unstyled"
            classNames={{ root: styles.field, input: styles.input }}
            inputContainer={(children) => (
              <Box className={styles.stack}>
                {interim && (
                  <Box ref={mirror} className={styles.mirror} aria-hidden="true">
                    {value}
                    <Text span inherit c="dimmed">
                      {interim}
                    </Text>
                  </Box>
                )}
                {children}
              </Box>
            )}
            {...skills.fieldProps}
            data-interim={interim ? true : undefined}
            aria-label={`Message ${assistantName}`}
            placeholder={`Message ${assistantName}…`}
            autosize
            minRows={1}
            maxRows={10}
            maxLength={LIMITS.maxPromptChars}
            value={shown}
            readOnly={busy}
            disabled={disabled}
            onChange={(event) => {
              skills.track(event.currentTarget);
              edit(event.currentTarget.value);
            }}
            onSelect={(event) => skills.track(event.currentTarget)}
            onScroll={(event) => {
              if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
            }}
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
          <Group
            gap={size === 44 ? 4 : "xs"}
            wrap="nowrap"
            className={styles.footer}
            data-composer-toolbar
          >
            <ComposerTools
              fit={fit}
              attachments={attachments}
              attachmentsDisabled={attachmentsDisabled}
              skills={skills}
              skillsDisabled={disabled || busy}
              mic={<MicButton dictation={dictation} disabled={disabled || busy} />}
            />
            <Box className={styles.controls}>
              <ModeChip settings={settings} compact={fit === "narrow"} />
              <SessionControls settings={settings} fit={fit} />
            </Box>
            {shown.length >= COUNTER_FROM && (
              <Text
                span
                size="xs"
                c={shown.length >= LIMITS.maxPromptChars ? "red" : "dimmed"}
                className={styles.counter}
              >
                {shown.length.toLocaleString()} / {LIMITS.maxPromptChars.toLocaleString()}
              </Text>
            )}
            <ContextUsageIndicator connection={connection} />
            <SendButton
              canSend={canSend}
              busy={busy}
              disabled={disabled}
              showStop={showStop}
              stopping={stopping}
              onStop={onStop}
              onSubmit={submit}
            />
          </Group>
        </Paper>
      </SkillPicker>
    </form>
  );
}

/** A short alert above the field: a failed send, an unconfirmed one or a dictation problem. */
function Notice({
  kind,
  onDismiss,
  children,
}: {
  kind: ComposerNotice["kind"];
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <Alert
      variant="light"
      color={kind === "error" ? "red" : "yellow"}
      radius="md"
      py="xs"
      px="sm"
      mx="xs"
      mt="xs"
      icon={<AlertIcon size={14} />}
      withCloseButton={onDismiss !== undefined}
      closeButtonLabel="Dismiss"
      onClose={onDismiss}
    >
      {children}
    </Alert>
  );
}
