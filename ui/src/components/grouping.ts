import { dayKey, toDate } from "./timeFormat";

export type Author = "user" | "assistant" | "error";

export interface RunPosition {
  /** Continues a run of turns by the same author, so it skips the author row. */
  continued: boolean;
  /** Ends its run, so it carries the run's time. */
  endsRun: boolean;
}

/**
 * Places each row in its run of turns by the same author on the same local day: only the first turn
 * of a run shows the author row and only the last shows the time. Errors always stand alone.
 */
export function markRuns<T extends { author: Author; timestamp: string }>(
  rows: T[],
): (T & RunPosition)[] {
  let previousAuthor: Author | null = null;
  let previousDay: string | null = null;
  const marked = rows.map((row) => {
    const date = toDate(row.timestamp);
    const day = date ? dayKey(date) : previousDay;
    const continued =
      row.author !== "error" && row.author === previousAuthor && day === previousDay;
    previousAuthor = row.author;
    previousDay = day;
    return { ...row, continued, endsRun: true };
  });
  marked.forEach((row, index) => {
    row.endsRun = !marked[index + 1]?.continued;
  });
  return marked;
}

export type TimelineItem<E, A> = { kind: "entry"; entry: E } | { kind: "activity"; items: A[] };

/**
 * Merges activity into the entries by time (an entry wins a tie) and gathers each run of
 * consecutive activity into one group, so a turn's steps sit together between its messages.
 */
export function interleaveActivity<
  E extends { timestamp: string },
  A extends { timestamp: string },
>(entries: readonly E[], activity: readonly A[]): TimelineItem<E, A>[] {
  const timeline: TimelineItem<E, A>[] = [];
  let next = 0;
  const flushBefore = (timestamp?: string) => {
    const items: A[] = [];
    while (
      next < activity.length &&
      (timestamp === undefined || activity[next]!.timestamp < timestamp)
    ) {
      items.push(activity[next]!);
      next += 1;
    }
    if (items.length > 0) timeline.push({ kind: "activity", items });
  };
  for (const entry of entries) {
    flushBefore(entry.timestamp);
    timeline.push({ kind: "entry", entry });
  }
  flushBefore();
  return timeline;
}
