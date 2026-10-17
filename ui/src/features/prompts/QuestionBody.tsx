import { Button, Textarea } from "@mantine/core";
import { useState, type KeyboardEvent } from "react";
import { MarkdownView } from "../../MarkdownView";
import type { QuestionPrompt } from "../../shared";
import { Actions, MAX_ANSWER, type BodyProps } from "./PromptBody";
import styles from "./PendingPrompts.module.css";

export function QuestionBody({ prompt, locked, busy, onAnswer }: BodyProps<QuestionPrompt>) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
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
  return (
    <>
      <div className={styles.message}>
        <MarkdownView text={prompt.question} />
      </div>
      {prompt.choices.length > 0 && (
        <div className={styles.choices} role="group" aria-label="Choices">
          {prompt.choices.map((choice) => (
            <Button
              key={choice}
              className={styles.choice}
              variant="default"
              justify="flex-start"
              disabled={locked}
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
    </>
  );
}
