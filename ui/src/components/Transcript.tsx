import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ActivityItem, TranscriptEntry } from "../shared";
import { ActivityGroup } from "./ActivityRows";
import { ArrowDownIcon } from "./ChatIcons";
import type { RunPosition } from "./grouping";
import { AssistantMessage, Avatar, ErrorMessage, UserMessage } from "./Message";
import { DaySeparator } from "./Timestamp";
import { toDate } from "./timeFormat";
import { buildRows, sameRow, type PendingMessage, type TranscriptRow } from "./transcriptRows";
import styles from "./Transcript.module.css";

export type { PendingMessage } from "./transcriptRows";

interface TranscriptProps {
  entries: TranscriptEntry[];
  pending: PendingMessage[];
  /** Thinking blocks and the current turn's tool calls, oldest first. */
  activity?: ActivityItem[];
  /** A turn is running: its tool calls are shown too. */
  live?: boolean;
  assistantName: string;
  description?: string;
  /** Fills the composer with an example prompt; never sends it. */
  onPickPrompt: (text: string) => void;
}

const PIN_THRESHOLD_PX = 48;
const NO_ACTIVITY: ActivityItem[] = [];

const EXAMPLE_PROMPTS = [
  "Summarize what we have done in this session",
  "What should I work on next?",
  "Help me make this canvas my own: suggest panels and tweaks, then build them in my copy",
];

function EmptyState({
  assistantName,
  description,
  onPickPrompt,
}: Pick<TranscriptProps, "assistantName" | "description" | "onPickPrompt">) {
  return (
    <Stack align="flex-start" gap="xs" className={styles.empty}>
      <Avatar name={assistantName} size="lg" />
      <Title order={2} fz="lg" lh={1.35} mt="xs">
        Start a conversation with {assistantName}
      </Title>
      <Text c="dimmed" maw="52ch" lh={1.5}>
        {description ?? "Messages you send here go to your current Copilot session."}
      </Text>
      <Group gap="xs" mt="sm" role="group" aria-label="Example prompts">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            variant="default"
            radius="md"
            px="sm"
            classNames={{ root: styles.prompt, label: styles.promptLabel }}
            onClick={() => onPickPrompt(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}

function EntryView({
  entry,
  assistantName,
  run,
}: {
  entry: TranscriptEntry;
  assistantName: string;
  run: RunPosition;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <UserMessage
          text={entry.text}
          timestamp={entry.timestamp}
          {...run}
          attachments={entry.attachments}
        />
      );
    case "error":
      return <ErrorMessage text={entry.text} timestamp={entry.timestamp} />;
    default:
      return (
        <AssistantMessage
          text={entry.text}
          timestamp={entry.timestamp}
          streaming={entry.streaming}
          assistantName={assistantName}
          {...run}
        />
      );
  }
}

function RowContent({ row, assistantName }: { row: TranscriptRow; assistantName: string }) {
  switch (row.kind) {
    case "entry":
      return (
        <EntryView
          entry={row.entry}
          assistantName={assistantName}
          run={{ continued: row.continued, endsRun: row.endsRun }}
        />
      );
    case "pending": {
      const { message } = row;
      return (
        <UserMessage
          text={message.text}
          timestamp={message.createdAt}
          continued={row.continued}
          endsRun={row.endsRun}
          attachments={message.attachments}
          pendingLabel={
            message.state === "sending"
              ? "Sending…"
              : message.mode === "enqueue"
                ? "Queued"
                : "Steering"
          }
        />
      );
    }
    case "activity":
      return <ActivityGroup items={row.items} />;
  }
}

/** One row and the day separator above it. Only rows whose content changed render again. */
const RowView = memo(
  function RowView({ row, assistantName }: { row: TranscriptRow; assistantName: string }) {
    const date = row.separator ? toDate(row.separator) : null;
    return (
      <>
        {date && <DaySeparator date={date} />}
        <RowContent row={row} assistantName={assistantName} />
      </>
    );
  },
  (a, b) => a.assistantName === b.assistantName && sameRow(a.row, b.row),
);

// Longer conversations render only the rows near the viewport (plus overscan). Shorter ones stay
// whole, so the browser's find-in-page sees every message.
const VIRTUALIZE_AFTER = 80;
const ESTIMATED_ROW_PX = 160;

function VirtualRows({
  rows,
  scroller,
  assistantName,
}: {
  rows: TranscriptRow[];
  scroller: RefObject<HTMLDivElement | null>;
  assistantName: string;
}) {
  // The renderer doesn't use the React Compiler, so its memoization caveat doesn't apply.
  // oxlint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
  });
  return (
    <div className={styles.virtual} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className={styles.virtualRow}
          style={{ transform: `translateY(${item.start}px)` }}
        >
          <RowView row={rows[item.index]!} assistantName={assistantName} />
        </div>
      ))}
    </div>
  );
}

export function Transcript({
  entries,
  pending,
  activity = NO_ACTIVITY,
  live = false,
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

  // A scroll away from the bottom unpins, unless it came with no input from the reader while the
  // content changed height: that is the layout moving (rows measured, a long transcript arriving),
  // so a pinned view goes back to the bottom. Find-in-page still unpins.
  const userScrolled = useRef(false);
  const lastHeight = useRef(0);
  const pin = useCallback(() => {
    pinned.current = true;
    userScrolled.current = false;
    setShowJump(false);
  }, []);
  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const resized = element.scrollHeight !== lastHeight.current;
    lastHeight.current = element.scrollHeight;
    if (distance <= PIN_THRESHOLD_PX) return pin();
    if (pinned.current && resized && !userScrolled.current) return scrollToBottom();
    pinned.current = false;
    setShowJump(true);
  }, [pin, scrollToBottom]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const mark = () => {
      userScrolled.current = true;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of inputs) element.addEventListener(name, mark, { passive: true });
    return () => {
      for (const name of inputs) element.removeEventListener(name, mark);
    };
  }, []);

  // Follow new content only while the reader is already at the bottom.
  useLayoutEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [entries, pending, activity, scrollToBottom]);

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
      pin();
      scrollToBottom();
    }
  }, [pendingCount, pin, scrollToBottom]);

  const empty = entries.length === 0 && pending.length === 0;
  const rows = useMemo(
    () => buildRows(entries, pending, activity, live),
    [entries, pending, activity, live],
  );

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
          ) : rows.length > VIRTUALIZE_AFTER ? (
            <VirtualRows rows={rows} scroller={scroller} assistantName={assistantName} />
          ) : (
            rows.map((row) => <RowView key={row.key} row={row} assistantName={assistantName} />)
          )}
        </div>
      </div>
      {showJump && (
        <Button
          size="xs"
          radius="xl"
          variant="default"
          c="dimmed"
          className={styles.jump}
          leftSection={<ArrowDownIcon size={14} />}
          onClick={() => {
            pin();
            scrollToBottom();
          }}
        >
          Jump to latest
        </Button>
      )}
    </div>
  );
}
