import { Alert, Button, Text } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarkdownView } from "../MarkdownView";
import type { TranscriptEntry } from "../shared";

/** A message the user just sent that the transcript has not confirmed yet. */
export interface PendingMessage {
  requestId: string;
  messageId?: string;
  text: string;
  state: "sending" | "accepted";
}

interface TranscriptProps {
  entries: TranscriptEntry[];
  pending: PendingMessage[];
}

const PIN_THRESHOLD_PX = 48;

function EntryView({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "error") {
    return (
      <Alert color="red" variant="light" title="Error" className="entry entry-error">
        <span className="plain-text">{entry.text}</span>
      </Alert>
    );
  }
  if (entry.kind === "user") {
    return (
      <div className="entry entry-user">
        <div className="bubble bubble-user plain-text">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="entry entry-assistant" data-streaming={entry.streaming ? "true" : undefined}>
      <div className="bubble bubble-assistant">
        {entry.text.length > 0 && <MarkdownView text={entry.text} />}
        {entry.streaming && (
          <span className="streaming-indicator" role="img" aria-label="Copilot is responding">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    </div>
  );
}

export function Transcript({ entries, pending }: TranscriptProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinned.current = distance <= PIN_THRESHOLD_PX;
    setShowJump(!pinned.current);
  }, []);

  // Follow new content only while the reader is already at the bottom.
  useLayoutEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [entries, pending, scrollToBottom]);

  // Layout changes (streaming growth, composer resize, on-screen keyboard) keep the pin too.
  useEffect(() => {
    const target = content.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    observer.observe(target);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Sending a message always jumps to the bottom.
  const pendingCount = pending.length;
  useLayoutEffect(() => {
    if (pendingCount > 0) {
      pinned.current = true;
      setShowJump(false);
      scrollToBottom();
    }
  }, [pendingCount, scrollToBottom]);

  const empty = entries.length === 0 && pending.length === 0;

  return (
    <div className="transcript-wrap">
      <div
        ref={scroller}
        className="transcript"
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation"
        tabIndex={0}
      >
        <div ref={content} className="transcript-content">
          {empty && (
            <Text c="dimmed" ta="center" py="xl">
              No messages yet. Send a prompt to your Copilot session.
            </Text>
          )}
          {entries.map((entry) => (
            <EntryView key={entry.id} entry={entry} />
          ))}
          {pending.map((message) => (
            <div key={message.requestId} className="entry entry-user">
              <div className="bubble bubble-user bubble-pending plain-text">{message.text}</div>
              <Text size="xs" c="dimmed" className="pending-label">
                {message.state === "sending" ? "Sending…" : "Sent — waiting for confirmation…"}
              </Text>
            </div>
          ))}
        </div>
      </div>
      {showJump && (
        <Button
          className="jump-latest"
          size="xs"
          radius="xl"
          variant="default"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            scrollToBottom();
          }}
        >
          Jump to latest
        </Button>
      )}
    </div>
  );
}
