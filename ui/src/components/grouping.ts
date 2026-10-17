import { dayKey, toDate } from "./timeFormat";

export type Author = "user" | "assistant" | "error";

/**
 * Flags each row that continues a run of turns by the same author on the same local day, so only
 * the first turn of a run shows the author row. Errors always stand alone.
 */
export function markContinuations<T extends { author: Author; timestamp: string }>(
  rows: T[],
): (T & { continued: boolean })[] {
  let previousAuthor: Author | null = null;
  let previousDay: string | null = null;
  return rows.map((row) => {
    const date = toDate(row.timestamp);
    const day = date ? dayKey(date) : previousDay;
    const continued =
      row.author !== "error" && row.author === previousAuthor && day === previousDay;
    previousAuthor = row.author;
    previousDay = day;
    return { ...row, continued };
  });
}
