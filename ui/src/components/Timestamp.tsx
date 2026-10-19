import { useSyncExternalStore } from "react";
import styles from "./Timestamp.module.css";
import { formatDayLabel, formatFullTimestamp, formatTimestamp, toDate } from "./timeFormat";

const MINUTE = 60_000;

// One timer for every timestamp on the page, aligned to the next minute boundary.
let now = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function schedule() {
  timer = setTimeout(
    () => {
      now = Date.now();
      for (const listener of listeners) listener();
      schedule();
    },
    MINUTE - (Date.now() % MINUTE) + 50,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearTimeout(timer);
  };
}

/** Current time in ms, re-rendering at most once a minute. */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

interface TimestampProps {
  value: string | Date;
  className?: string;
}

/** Compact turn time ("just now", "2m", "14:05", ...) with the full date and time on hover. */
export function Timestamp({ value, className }: TimestampProps) {
  const current = useMinuteClock();
  const date = toDate(value);
  if (!date) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={formatFullTimestamp(date)}
      className={className ? `${styles.time} ${className}` : styles.time}
    >
      {formatTimestamp(date, new Date(current))}
    </time>
  );
}

/** Centered rule with the day label, shown where the conversation crosses a date. */
export function DaySeparator({ date }: { date: Date }) {
  const label = formatDayLabel(date, new Date(useMinuteClock()));
  return (
    <div className={styles.separator} role="separator" aria-label={label}>
      <span className={styles.separatorLabel}>{label}</span>
    </div>
  );
}
