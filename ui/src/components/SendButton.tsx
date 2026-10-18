import { ActionIcon, Tooltip } from "@mantine/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { SendMode } from "../shared";
import { Icon, SendIcon, StopIcon } from "./ChatIcons";
import { createSendPress, queueHintAfter, queuesOnEnter, type QueueHintEvent } from "./sendPress";
import { useTouchSize } from "./touchSize";
import styles from "./Composer.module.css";

// Stop is neutral: it ends work rather than starting it.
const stopColors = () => ({
  root: {
    "--ai-bg": "var(--cc-text)",
    "--ai-hover": "color-mix(in srgb, var(--cc-text) 85%, var(--cc-surface))",
    "--ai-color": "var(--cc-surface)",
  },
});

const QueueIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 6h12M4 12h12M4 18h7M18 14v7M14.5 17.5h7" />
  </Icon>
);

/** True while Ctrl or Cmd is held with focus inside the button's composer form. */
function useQueueHint(button: RefObject<HTMLElement | null>) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const update = (event: QueueHintEvent) => setHint(queueHintAfter(event));
    const onKey = (event: KeyboardEvent) => {
      const form = button.current?.closest("form");
      update({
        type: event.type === "keydown" ? "keydown" : "keyup",
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        composerFocused: Boolean(form?.contains(document.activeElement)),
      });
    };
    const onFocusOut = (event: FocusEvent) => {
      const form = button.current?.closest("form");
      if (!form?.contains(event.relatedTarget as Node | null)) update({ type: "focusout" });
    };
    const onBlur = () => update({ type: "blur" });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") update({ type: "hidden" });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [button]);
  return hint;
}

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
  const size = useTouchSize();
  const button = useRef<HTMLButtonElement>(null);
  const keyHint = useQueueHint(button);
  const [armed, setArmed] = useState(false);
  const latest = useRef({ canSend, onSubmit });
  latest.current = { canSend, onSubmit };
  const press = useRef(
    createSendPress(
      () => {
        if (latest.current.canSend) latest.current.onSubmit("enqueue");
      },
      (next) => {
        setArmed(next);
        if (next) navigator.vibrate?.(10);
      },
    ),
  ).current;
  useEffect(() => () => press.cancel(), [press]);
  useEffect(() => {
    if (!canSend) press.cancel();
  }, [canSend, press]);
  const queueing = !showStop && (armed || keyHint);

  return (
    <Tooltip label="Queue" opened={queueing && !busy} position="top" withArrow>
      <ActionIcon
        ref={button}
        size={size}
        radius="md"
        ml="auto"
        variant={queueing ? "light" : "filled"}
        className={styles.send}
        vars={showStop ? stopColors : undefined}
        loading={busy || stopping}
        loaderProps={{ size: 14 }}
        disabled={showStop ? disabled || stopping : !canSend}
        aria-label={
          showStop
            ? stopping
              ? "Stopping"
              : "Stop"
            : busy
              ? "Sending"
              : queueing
                ? "Queue message"
                : "Send message"
        }
        aria-keyshortcuts={showStop ? "Escape" : "Enter Control+Enter Meta+Enter Alt+Enter"}
        title={showStop ? "Stop (Esc)" : "Send now (Enter). Hold or press Ctrl+Enter to queue."}
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
          if (event.key === "Enter" && queuesOnEnter(event) && canSend) {
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
        {showStop ? (
          <StopIcon size={16} />
        ) : queueing ? (
          <QueueIcon size={16} />
        ) : (
          <SendIcon size={16} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
