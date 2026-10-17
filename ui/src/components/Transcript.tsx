import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TranscriptEntry } from "../shared";
import { ArrowDownIcon } from "./ChatIcons";
import { AssistantMessage, Avatar, ErrorMessage, UserMessage } from "./Message";
import { DaySeparator } from "./Timestamp";
import { dayKey, toDate } from "./timeFormat";
import styles from "./Transcript.module.css";

/** A message the user just sent that the transcript has not confirmed yet. */
export interface PendingMessage {
  requestId: string;
  messageId?: string;
  text: string;
  state: "sending" | "accepted";
  /** ISO time the user pressed send. */
  createdAt: string;
}

interface TranscriptProps {
  entries: TranscriptEntry[];
  pending: PendingMessage[];
  assistantName: string;
  description?: string;
  /** Fills the composer with an example prompt; never sends it. */
  onPickPrompt: (text: string) => void;
}

const PIN_THRESHOLD_PX = 48;

const EXAMPLE_PROMPTS = [
  "Summarize what we have done in this session",
  "What should I work on next?",
  "Explain the last change you made",
];

function EmptyState({
  assistantName,
  description,
  onPickPrompt,
}: Pick<TranscriptProps, "assistantName" | "description" | "onPickPrompt">) {
  return (
    <div className={styles.empty}>
      <Avatar name={assistantName} size="lg" />
      <h2 className={styles.emptyTitle}>Start a conversation with {assistantName}</h2>
      <p className={styles.emptyText}>
        {description ?? "Messages you send here go to your current Copilot session."}
      </p>
      <div className={styles.prompts} role="group" aria-label="Example prompts">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.prompt}
            onClick={() => onPickPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function EntryView({ entry, assistantName }: { entry: TranscriptEntry; assistantName: string }) {
  switch (entry.kind) {
    case "user":
      return <UserMessage text={entry.text} timestamp={entry.timestamp} />;
    case "error":
      return <ErrorMessage text={entry.text} timestamp={entry.timestamp} />;
    default:
      return (
        <AssistantMessage
          text={entry.text}
          timestamp={entry.timestamp}
          streaming={entry.streaming}
          assistantName={assistantName}
        />
      );
  }
}

/** Interleaves day separators wherever the local calendar date changes between turns. */
function withDaySeparators(rows: { key: string; timestamp: string; node: ReactNode }[]) {
  let previousDay: string | null = null;
  return rows.map(({ key, timestamp, node }) => {
    const date = toDate(timestamp);
    const day = date ? dayKey(date) : previousDay;
    const separator = date && day !== previousDay ? <DaySeparator date={date} /> : null;
    previousDay = day;
    return (
      <Fragment key={key}>
        {separator}
        {node}
      </Fragment>
    );
  });
}

export function Transcript({
  entries,
  pending,
  assistantName,
  description,
  onPickPrompt,
}: TranscriptProps) {
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

  // Layout changes (streaming growth, composer or activity bar resize, on-screen keyboard) keep the pin.
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
  const rows = [
    ...entries.map((entry) => ({
      key: entry.id,
      timestamp: entry.timestamp,
      node: <EntryView entry={entry} assistantName={assistantName} />,
    })),
    ...pending.map((message) => ({
      key: `pending:${message.requestId}`,
      timestamp: message.createdAt,
      node: (
        <UserMessage
          text={message.text}
          timestamp={message.createdAt}
          pendingLabel={
            message.state === "sending" ? "Sending…" : "Sent, waiting for confirmation…"
          }
        />
      ),
    })),
  ];

  return (
    <div className={styles.wrap}>
      <div
        ref={scroller}
        className={styles.scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
        tabIndex={0}
      >
        <div ref={content} className={styles.content}>
          {empty ? (
            <EmptyState
              assistantName={assistantName}
              description={description}
              onPickPrompt={onPickPrompt}
            />
          ) : (
            withDaySeparators(rows)
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className={styles.jump}
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            scrollToBottom();
          }}
        >
          <ArrowDownIcon size={14} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
