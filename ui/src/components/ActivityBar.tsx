import { useState } from "react";
import type { SessionStatus } from "../shared";
import { AlertIcon } from "./ChatIcons";
import styles from "./ActivityBar.module.css";

export interface ActivityContent {
  tone: "working" | "waiting";
  title: string;
  detail?: string;
}

const WAITING_DETAIL: Record<NonNullable<SessionStatus["waitingFor"]>, string> = {
  permission: "Approve or deny the permission request in the Copilot app.",
  input: "Answer the question in the Copilot app.",
  elicitation: "Fill in the requested details in the Copilot app.",
  plan: "Review the plan in the Copilot app.",
};

/**
 * Maps the session status to the row shown above the composer; null when idle. While a prompt card
 * is shown (`promptShown`), the card is the waiting state and this row stays out of the way.
 */
export function describeActivity(
  status: SessionStatus,
  promptShown = false,
): ActivityContent | null {
  if (status.phase === "waiting") {
    if (promptShown) return null;
    return {
      tone: "waiting",
      title: "Waiting for you",
      detail: status.waitingFor
        ? WAITING_DETAIL[status.waitingFor]
        : "Answer the prompt in the Copilot app.",
    };
  }
  if (status.phase !== "working") return null;
  switch (status.activity) {
    case "thinking":
      return { tone: "working", title: "Thinking…" };
    case "responding":
      return { tone: "working", title: "Responding…" };
    case "tool":
      return {
        tone: "working",
        title: status.toolName ? `Running ${status.toolName}…` : "Running a tool…",
      };
    default:
      return { tone: "working", title: "Working…" };
  }
}

const sameContent = (a: ActivityContent | null, b: ActivityContent | null) =>
  a?.tone === b?.tone && a?.title === b?.title && a?.detail === b?.detail;

/**
 * Live activity row directly above the composer: thinking, responding or running a tool. It
 * collapses when idle. Requests the canvas can answer are shown as prompt cards instead; the
 * waiting line here is only the fallback for requests that must be answered in the Copilot app.
 */
export function ActivityBar({
  status,
  promptShown = false,
}: {
  status: SessionStatus;
  promptShown?: boolean;
}) {
  const content = describeActivity(status, promptShown);
  // Keep showing the last label while the row collapses, so the text does not vanish first.
  const [shown, setShown] = useState(content);
  if (content && !sameContent(content, shown)) setShown(content);

  return (
    <>
      <div className={styles.liveRegion} role="status" aria-live="polite">
        {content ? [content.title, content.detail].filter(Boolean).join(" ") : ""}
      </div>
      <div className={styles.collapse} data-open={content ? "true" : undefined} aria-hidden="true">
        <div className={styles.inner}>
          {shown && (
            <div className={styles.row} data-tone={shown.tone}>
              {shown.tone === "waiting" ? (
                <span className={styles.icon}>
                  <AlertIcon size={16} />
                </span>
              ) : (
                <span className={styles.dots}>
                  <span />
                  <span />
                  <span />
                </span>
              )}
              <span className={styles.title}>{shown.title}</span>
              {shown.detail && <span className={styles.detail}>{shown.detail}</span>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
