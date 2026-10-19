import { Button } from "@mantine/core";
import { useState } from "react";
import type { PermissionPrompt } from "../../shared";
import { AlertIcon } from "../../components/ChatIcons";
import { Actions, type BodyProps } from "./PromptBody";
import { DETAIL_LABELS } from "./labels";
import styles from "./PendingPrompts.module.css";

export function PermissionBody({ prompt, locked, busy, onAnswer }: BodyProps<PermissionPrompt>) {
  const [choice, setChoice] = useState<"approve" | "deny" | null>(null);
  const decide = (decision: "approve" | "deny") => {
    setChoice(decision);
    void onAnswer({ kind: "permission", decision });
  };
  return (
    <>
      {prompt.subject && <p className={styles.subject}>{prompt.subject}</p>}
      {prompt.intent && <p className={styles.intent}>{prompt.intent}</p>}
      {prompt.detail && (
        <pre className={styles.detail} tabIndex={0} aria-label={DETAIL_LABELS[prompt.permission]}>
          {prompt.detail}
        </pre>
      )}
      {prompt.warning && (
        <p className={styles.warning}>
          <AlertIcon size={14} />
          <span>{prompt.warning}</span>
        </p>
      )}
      <Actions>
        <Button
          className={styles.button}
          variant="default"
          disabled={locked}
          loading={busy && choice === "deny"}
          onClick={() => decide("deny")}
        >
          Deny
        </Button>
        <Button
          className={styles.button}
          disabled={locked}
          loading={busy && choice === "approve"}
          onClick={() => decide("approve")}
        >
          Allow once
        </Button>
      </Actions>
    </>
  );
}
