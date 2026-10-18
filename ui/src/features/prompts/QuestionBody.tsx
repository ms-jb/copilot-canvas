import { Button, Kbd, Textarea } from "@mantine/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownView } from "../../MarkdownView";
import type { QuestionPrompt } from "../../shared";
import { MAX_NUMBERED, choiceTarget } from "./choice-keys";
import { Actions, MAX_ANSWER, type BodyProps } from "./PromptBody";
import styles from "./PendingPrompts.module.css";

export function QuestionBody({ prompt, locked, busy, onAnswer }: BodyProps<QuestionPrompt>) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  // With a keyboard, the first choice takes focus so a number key and Enter answer at once. Never
  // over a draft being typed, and never on touch screens, where it would open the keyboard.
  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches) return;
    const typing = document.activeElement;
    if (typing instanceof HTMLTextAreaElement && typing.value.trim()) return;
    choices.current[0]?.focus({ preventScroll: true });
  }, []);
  const canSend = !locked && text.trim().length > 0;
  const sendText = () => {
    if (!canSend) return;
    setPicked(null);
    void onAnswer({ kind: "question", answer: text.trim(), freeform: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat) sendText();
  };
  // Arrows and digits only move focus; Enter or a click on the focused choice answers. Esc drops
  // a typed draft and leaves the card without answering.
  const onChoiceKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const buttons = choices.current;
    const next = choiceTarget(
      event.key,
      buttons.findIndex((button) => button === document.activeElement),
      buttons.length,
    );
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };
  const onCardKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.stopPropagation();
    setText("");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  return (
    <div className={styles.question} onKeyDown={onCardKey}>
      <div className={styles.message}>
        <MarkdownView text={prompt.question} />
      </div>
      {prompt.choices.length > 0 && (
        <div className={styles.choices} role="group" aria-label="Choices">
          {prompt.choices.map((choice, at) => (
            <Button
              key={choice}
              className={styles.choice}
              ref={(node) => {
                choices.current[at] = node;
              }}
              variant="default"
              justify="flex-start"
              disabled={locked}
              aria-keyshortcuts={at < MAX_NUMBERED ? String(at + 1) : undefined}
              leftSection={
                at < MAX_NUMBERED ? (
                  <Kbd size="xs" aria-hidden="true">
                    {at + 1}
                  </Kbd>
                ) : undefined
              }
              onKeyDown={onChoiceKey}
              loading={busy && picked === choice}
              onClick={() => {
                setPicked(choice);
                void onAnswer({ kind: "question", answer: choice, freeform: false });
              }}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      {prompt.allowFreeform && (
        <div className={styles.freeform}>
          <Textarea
            aria-label="Your answer"
            placeholder={
              prompt.choices.length > 0 ? "Or type your own answer…" : "Type your answer…"
            }
            autosize
            minRows={1}
            maxRows={6}
            maxLength={MAX_ANSWER}
            value={text}
            readOnly={busy}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
          />
          <Actions>
            <Button
              className={styles.button}
              disabled={!canSend}
              loading={busy && picked === null}
              onClick={sendText}
            >
              Send answer
            </Button>
          </Actions>
        </div>
      )}
    </div>
  );
}
