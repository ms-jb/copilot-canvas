import { APP_SESSION_ID, type SessionActivity, type SessionSummary } from "../../shared";

export const stateLabels: Record<SessionActivity, string> = {
  busy: "Busy",
  idle: "Idle",
  waiting: "Needs you",
  unknown: "Activity unknown",
};

export function relativeSessionTime(updatedAt: string | null, now: number): string {
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return "Time unknown";
  const minutes = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function sessionLink(row: SessionSummary, nativePanel: boolean): string | undefined {
  return nativePanel && row.canOpen && APP_SESSION_ID.test(row.id)
    ? `ghapp://sessions/${encodeURIComponent(row.id)}`
    : undefined;
}

/** True in the desktop app (served on loopback); a phone opens the canvas through its tunnel. */
export function nativeSessionPanel(hostname: string, preview: boolean): boolean {
  return !preview && ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}
