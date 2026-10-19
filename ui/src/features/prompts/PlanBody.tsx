import { Button, Textarea } from "@mantine/core";
import { useState } from "react";
import { MarkdownView } from "../../MarkdownView";
import type { PlanAction, PlanPrompt } from "../../shared";
import { Actions, MAX_ANSWER, type BodyProps } from "./PromptBody";
import { PLAN_ACTION_LABELS } from "./labels";
import styles from "./PendingPrompts.module.css";

export function PlanBody({ prompt, locked, busy, onAnswer }: BodyProps<PlanPrompt>) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  // The recommended action leads visually; nothing is ever chosen on the user's behalf.
  const ordered = prompt.recommended
    ? [prompt.recommended, ...prompt.actions.filter((action) => action !== prompt.recommended)]
    : prompt.actions;

  const approve = (action: PlanAction) => {
    setPending(action);
    void onAnswer({ kind: "plan", approved: true, action });
  };
  const sendFeedback = () => {
    setPending("changes");
    const text = feedback.trim();
    void onAnswer(
      text ? { kind: "plan", approved: false, feedback: text } : { kind: "plan", approved: false },
    );
  };

  return (
    <>
      <div className={styles.message}>
        <MarkdownView text={prompt.summary} />
      </div>
      {prompt.plan && (
        <div className={styles.plan} tabIndex={0} role="region" aria-label="Plan">
          <MarkdownView text={prompt.plan} />
        </div>
      )}
      {revising ? (
        <div className={styles.freeform}>
          <Textarea
            aria-label="What should change?"
            placeholder="What should change?"
            autosize
            minRows={2}
            maxRows={6}
            maxLength={MAX_ANSWER}
            value={feedback}
            readOnly={busy}
            onChange={(event) => setFeedback(event.currentTarget.value)}
          />
          <Actions>
            <Button
              className={styles.button}
              variant="default"
              disabled={locked}
              onClick={() => setRevising(false)}
            >
              Back
            </Button>
            <Button
              className={styles.button}
              disabled={locked}
              loading={busy && pending === "changes"}
              onClick={sendFeedback}
            >
              Send feedback
            </Button>
          </Actions>
        </div>
      ) : (
        <Actions>
          <Button
            className={styles.button}
            variant="default"
            disabled={locked}
            onClick={() => setRevising(true)}
          >
            Request changes
          </Button>
          {ordered.map((action, position) => (
            <Button
              key={action}
              className={styles.button}
              variant={position === 0 ? "filled" : "default"}
              disabled={locked}
              loading={busy && pending === action}
              onClick={() => approve(action)}
            >
              {PLAN_ACTION_LABELS[action]}
            </Button>
          ))}
        </Actions>
      )}
    </>
  );
}
