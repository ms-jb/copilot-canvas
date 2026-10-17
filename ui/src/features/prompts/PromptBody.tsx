import type { ReactNode } from "react";
import type { PromptResponse } from "../../shared";
import styles from "./PendingPrompts.module.css";

export const MAX_ANSWER = 4000;
export type Answer = (response: PromptResponse) => Promise<void>;

export interface BodyProps<P> {
  prompt: P;
  locked: boolean;
  busy: boolean;
  onAnswer: Answer;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
