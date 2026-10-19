// Pure row model for the conversation: what each row shows and when it must re-render.
import type { ActivityItem, SendMode, TranscriptAttachment, TranscriptEntry } from "../shared";
import { visibleActivity } from "./activity";
import { interleaveActivity, markRuns, type RunPosition } from "./grouping";
import { dayKey, toDate } from "./timeFormat";

/** A message the user just sent that the transcript has not confirmed yet. */
export interface PendingMessage {
  requestId: string;
  messageId?: string;
  text: string;
  state: "sending" | "accepted";
  /** ISO time the user pressed send. */
  createdAt: string;
  attachments?: TranscriptAttachment[];
  mode?: SendMode;
}

interface RowBase {
  key: string;
  /** The row's own timestamp when a day separator goes above it (the local date changed). */
  separator: string | null;
  /** The "N new" line that goes above this row: the first of the replies the reader hadn't seen. */
  unread: string | null;
}
export type TranscriptRow = RowBase &
  (
    | ({ kind: "entry"; entry: TranscriptEntry } & RunPosition)
    | ({ kind: "pending"; message: PendingMessage } & RunPosition)
    | { kind: "activity"; items: ActivityItem[] }
  );

/**
 * Orders entries, unconfirmed sends and visible activity into rows: runs of turns by one author,
 * steps between the messages of their turn, and a day separator wherever the local date changes.
 * `unread` puts its label above the entry it names.
 */
export function buildRows(
  entries: readonly TranscriptEntry[],
  pending: readonly PendingMessage[],
  activity: readonly ActivityItem[],
  live: boolean,
  unread: { entryId: string; label: string } | null = null,
): TranscriptRow[] {
  const messages = markRuns([
    ...entries.map((entry) => ({
      key: entry.id,
      timestamp: entry.timestamp,
      author: entry.kind === "user" || entry.kind === "error" ? entry.kind : ("assistant" as const),
      entry,
    })),
    ...pending.map((message) => ({
      key: `pending:${message.requestId}`,
      timestamp: message.createdAt,
      author: "user" as const,
      message,
    })),
  ]);
  let previousDay: string | null = null;
  return interleaveActivity(messages, visibleActivity(activity, live)).map((item) => {
    const timestamp = item.kind === "entry" ? item.entry.timestamp : item.items[0]!.timestamp;
    const date = toDate(timestamp);
    const day = date ? dayKey(date) : previousDay;
    const separator = date && day !== previousDay ? timestamp : null;
    previousDay = day;
    if (item.kind === "activity") {
      return {
        kind: "activity",
        key: `activity:${item.items[0]!.id}`,
        separator,
        unread: null,
        items: item.items,
      };
    }
    const { key, continued, endsRun } = item.entry;
    return "entry" in item.entry
      ? {
          kind: "entry",
          key,
          separator,
          unread: unread?.entryId === item.entry.entry.id ? unread.label : null,
          entry: item.entry.entry,
          continued,
          endsRun,
        }
      : {
          kind: "pending",
          key,
          separator,
          unread: null,
          message: item.entry.message,
          continued,
          endsRun,
        };
  });
}

const sameItems = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** True when `a` and `b` render the same: rows are rebuilt on every update, their content rarely. */
export function sameRow(a: TranscriptRow, b: TranscriptRow): boolean {
  if (a.key !== b.key || a.separator !== b.separator || a.unread !== b.unread) return false;
  switch (a.kind) {
    case "entry":
      return (
        b.kind === "entry" &&
        a.entry === b.entry &&
        a.continued === b.continued &&
        a.endsRun === b.endsRun
      );
    case "pending":
      return (
        b.kind === "pending" &&
        a.message === b.message &&
        a.continued === b.continued &&
        a.endsRun === b.endsRun
      );
    case "activity":
      return b.kind === "activity" && sameItems(a.items, b.items);
  }
}
