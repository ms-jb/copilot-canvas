import { Alert } from "@mantine/core";
import { useState } from "react";
import type { SendContext } from "../../api";
import type { PendingPrompt } from "../../shared";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "../../components/ChatIcons";
import { FormBody } from "./FormBody";
import { PermissionBody } from "./PermissionBody";
import { PlanBody } from "./PlanBody";
import { QuestionBody } from "./QuestionBody";
import { promptTitle } from "./labels";
import { usePromptAnswer } from "./usePromptAnswer";
import type { Answer } from "./PromptBody";
import styles from "./PendingPrompts.module.css";

interface PendingPromptsProps {
  prompts: PendingPrompt[];
  context: SendContext | null;
  disabled: boolean;
  assistantName: string;
  onStale: () => void;
}

/**
 * The requests the session is waiting on, answered right here. One card is in focus at a time;
 * every decision is an explicit click, nothing is pre-selected, and nothing takes focus away from
 * the composer. A request answered elsewhere simply disappears.
 */
export function PendingPrompts({
  prompts,
  context,
  disabled,
  assistantName,
  onStale,
}: PendingPromptsProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const {
    answered,
    failures,
    sending,
    answer: submit,
  } = usePromptAnswer({
    prompts,
    context,
    disabled,
    onStale,
  });
  const visible = prompts.filter((prompt) => !answered.has(prompt.requestId));
  const index = Math.max(
    0,
    visible.findIndex((prompt) => prompt.requestId === focusedId),
  );
  const current = visible[index];

  if (!current) return null;
  const requestId = current.requestId;
  const answer: Answer = (response) => submit(requestId, response);
  const busy = sending === requestId;
  const locked = disabled || context === null || busy;
  const failure = failures[requestId];
  const title = promptTitle(current, assistantName);
  const headingId = `prompt-title-${index}`;
  const go = (step: number) => {
    const next = visible[(index + step + visible.length) % visible.length];
    if (next) setFocusedId(next.requestId);
  };

  return (
    <section className={styles.stack} aria-label="Waiting for your answer">
      <div className={styles.liveRegion} role="status" aria-live="polite">
        {title}
      </div>
      <article className={styles.card} aria-labelledby={headingId} aria-busy={busy}>
        <header className={styles.header}>
          <span className={styles.icon}>
            <AlertIcon size={18} />
          </span>
          <h2 className={styles.title} id={headingId}>
            {title}
          </h2>
          {visible.length > 1 && (
            <nav className={styles.pager} aria-label="Pending requests">
              <button
                type="button"
                className={styles.pagerButton}
                onClick={() => go(-1)}
                aria-label="Previous request"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <span className={styles.count}>
                {index + 1} of {visible.length}
              </span>
              <button
                type="button"
                className={styles.pagerButton}
                onClick={() => go(1)}
                aria-label="Next request"
              >
                <ChevronRightIcon size={16} />
              </button>
            </nav>
          )}
        </header>
        <div className={styles.body} key={requestId}>
          {current.kind === "permission" && (
            <PermissionBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "question" && (
            <QuestionBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "form" && (
            <FormBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "plan" && (
            <PlanBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {failure && (
            <Alert
              color={failure.tone === "error" ? "red" : "yellow"}
              variant="light"
              icon={<AlertIcon size={16} />}
              title={failure.tone === "error" ? "Your answer wasn't applied" : "Not confirmed yet"}
            >
              {failure.message}
            </Alert>
          )}
        </div>
      </article>
    </section>
  );
}
