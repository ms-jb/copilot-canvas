import { Loader } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { SendMode } from "../shared";
import { SendIcon, StopIcon } from "./ChatIcons";
import { createSendPress } from "./sendPress";
import styles from "./Composer.module.css";

export function SendButton({
  canSend,
  busy,
  disabled,
  showStop,
  stopping,
  onStop,
  onSubmit,
}: {
  canSend: boolean;
  busy: boolean;
  disabled: boolean;
  showStop: boolean;
  stopping: boolean;
  onStop?: () => void;
  onSubmit: (mode: SendMode) => void;
}) {
  const latest = useRef({ canSend, onSubmit });
  latest.current = { canSend, onSubmit };
  const press = useRef(
    createSendPress(() => {
      if (latest.current.canSend) latest.current.onSubmit("enqueue");
    }),
  ).current;
  useEffect(() => () => press.cancel(), [press]);
  useEffect(() => {
    if (!canSend) press.release();
  }, [canSend, press]);

  return (
    <button
      type="button"
      className={styles.send}
      data-variant={showStop ? "stop" : undefined}
      disabled={showStop ? disabled || stopping : !canSend}
      aria-label={showStop ? (stopping ? "Stopping" : "Stop") : busy ? "Sending" : "Send message"}
      aria-keyshortcuts={showStop ? "Escape" : "Enter Alt+Enter"}
      title={showStop ? "Stop (Esc)" : "Send now (Enter). Hold to queue, or press Alt+Enter."}
      onPointerDown={(event) => {
        if (event.button === 0 && event.isPrimary && canSend && !showStop) press.start();
      }}
      onPointerUp={press.release}
      onPointerLeave={press.cancel}
      onPointerCancel={press.cancel}
      onContextMenu={(event) => {
        if (!showStop) event.preventDefault();
      }}
      onKeyDown={(event) => {
        press.keyboard();
        if (event.key === "Enter" && event.altKey && canSend) {
          event.preventDefault();
          if (!event.repeat) onSubmit("enqueue");
        }
      }}
      onClick={() => {
        if (!press.click()) return;
        if (showStop) onStop?.();
        else if (canSend) onSubmit("immediate");
      }}
    >
      {busy || stopping ? (
        <Loader size={14} color="currentColor" />
      ) : showStop ? (
        <StopIcon size={16} />
      ) : (
        <SendIcon size={16} />
      )}
    </button>
  );
}
