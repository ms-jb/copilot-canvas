// Pure date helpers for transcript timestamps. `now` is always passed in so output is testable.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Parses an ISO string or Date; returns null for anything that is not a valid date. */
export function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Local calendar day key (yyyy-mm-dd) used to place day separators. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between the two local dates (0 = same day, 1 = yesterday). */
function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / (24 * HOUR_MS));
}

function clock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * Short label for a turn:
 * - under a minute old (or slightly in the future from clock skew): "just now"
 * - under an hour old: "2m"
 * - earlier today: "14:05"
 * - yesterday: "Yesterday 14:05"
 * - this year: "Mar 3, 14:05"
 * - older: "Mar 3, 2025, 14:05"
 * Times use the reader's locale, so 12-hour locales show "2:05 PM".
 */
export function formatTimestamp(date: Date, now: Date, locale?: string): string {
  const age = now.getTime() - date.getTime();
  if (age < MINUTE_MS) return "just now";
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m`;
  const days = daysAgo(date, now);
  if (days <= 0) return clock(date, locale);
  if (days === 1) return `Yesterday ${clock(date, locale)}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Full date and time for tooltips, e.g. "Tuesday, March 3, 2026 at 14:05:09". */
export function formatFullTimestamp(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" }).format(date);
}

/** Day separator label: "Today", "Yesterday", "Tuesday, March 3" or "March 3, 2025". */
export function formatDayLabel(date: Date, now: Date, locale?: string): string {
  const days = daysAgo(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    sameYear
      ? { weekday: "long", month: "long", day: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" },
  ).format(date);
}
