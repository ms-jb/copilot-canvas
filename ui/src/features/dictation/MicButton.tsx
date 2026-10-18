import { Text, VisuallyHidden } from "@mantine/core";
import { formatElapsed } from "./model";
import type { Dictation } from "./useDictation";
import { ComposerIconButton } from "../../components/ComposerIconButton";
import styles from "./Dictation.module.css";

const ANNOUNCE: Record<string, string> = {
  starting: "Starting the microphone",
  recording:
    "Listening. Your words appear in the message box. Press the microphone or Escape to stop.",
};

/** Only browsers with speech recognition show a microphone. */
export function MicButton({ dictation, disabled }: { dictation: Dictation; disabled: boolean }) {
  const { state, engine, elapsedMs, toggle } = dictation;
  const { phase } = state;
  const active = phase === "starting" || phase === "recording";
  const label = active ? "Stop dictation" : "Dictate";
  if (engine === null) return null;
  return (
    <>
      <ComposerIconButton
        label={label}
        tip={active ? "Stop dictation (Esc)" : label}
        active={active}
        color={active ? "red" : "gray"}
        className={styles.mic}
        data-state={phase}
        disabled={disabled && !active}
        loading={phase === "starting"}
        loaderProps={{ size: 16 }}
        aria-pressed={active}
        onClick={toggle}
      >
        {active ? (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <rect
              x="9"
              y="3"
              width="6"
              height="11"
              rx="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </ComposerIconButton>
      {phase === "recording" && (
        <Text span size="xs" c="red" className={styles.elapsed} aria-hidden="true">
          <span className={styles.dot} />
          {formatElapsed(elapsedMs)}
        </Text>
      )}
      <VisuallyHidden role="status" aria-live="polite">
        {ANNOUNCE[phase] ?? ""}
      </VisuallyHidden>
    </>
  );
}
