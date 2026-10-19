import { isPlainObject, onlyKeys, SESSION_ID_PATTERN } from "./validation.mts";

export const MAX_SESSIONS = 30;
export const APP_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SessionActivity = "busy" | "idle" | "waiting" | "unknown";

export interface SessionSummary {
  id: string;
  title: string;
  project: string | null;
  state: SessionActivity;
  updatedAt: string | null;
  current: boolean;
  /** True only for an id reported by the app, never inferred from local metadata. */
  canOpen: boolean;
}

export interface SessionsInfo {
  sessionId: string;
  source: "app" | "local" | "unavailable";
  checkedAt: string;
  sessions: SessionSummary[];
}

export function isSessionTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    value.length <= 35 &&
    Number.isFinite(Date.parse(value))
  );
}

function displayText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

export function validateSessions(value: unknown): value is SessionsInfo {
  if (
    !isPlainObject(value) ||
    !onlyKeys(value, ["sessionId", "source", "checkedAt", "sessions"]) ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID_PATTERN.test(value.sessionId) ||
    !["app", "local", "unavailable"].includes(String(value.source)) ||
    !isSessionTime(value.checkedAt) ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > MAX_SESSIONS ||
    (value.source === "unavailable" && value.sessions.length !== 0)
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value.sessions.every((row) => {
    if (
      !isPlainObject(row) ||
      !onlyKeys(row, ["id", "title", "project", "state", "updatedAt", "current", "canOpen"]) ||
      typeof row.id !== "string" ||
      !SESSION_ID_PATTERN.test(row.id) ||
      ids.has(row.id) ||
      !displayText(row.title, 160) ||
      !(row.project === null || displayText(row.project, 80)) ||
      !["busy", "idle", "waiting", "unknown"].includes(String(row.state)) ||
      !(row.updatedAt === null || isSessionTime(row.updatedAt)) ||
      typeof row.current !== "boolean" ||
      row.current !== (row.id === value.sessionId) ||
      typeof row.canOpen !== "boolean" ||
      (row.canOpen && (value.source !== "app" || !APP_SESSION_ID.test(row.id)))
    ) {
      return false;
    }
    ids.add(row.id);
    return true;
  });
}
