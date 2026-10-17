import { isPlainObject, onlyKeys, SESSION_ID_PATTERN } from "./validation.mjs";
export const MAX_SESSIONS = 30;
export const APP_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSessionTime(value) {
    return (typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        value.length <= 35 &&
        Number.isFinite(Date.parse(value)));
}
function displayText(value, max) {
    return (typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= max &&
        !/[\p{Cc}\p{Cf}]/u.test(value));
}
export function validateSessions(value) {
    if (!isPlainObject(value) ||
        !onlyKeys(value, ["sessionId", "source", "checkedAt", "sessions"]) ||
        typeof value.sessionId !== "string" ||
        !SESSION_ID_PATTERN.test(value.sessionId) ||
        !["app", "local", "unavailable"].includes(String(value.source)) ||
        !isSessionTime(value.checkedAt) ||
        !Array.isArray(value.sessions) ||
        value.sessions.length > MAX_SESSIONS ||
        (value.source === "unavailable" && value.sessions.length !== 0)) {
        return false;
    }
    const ids = new Set();
    return value.sessions.every((row) => {
        if (!isPlainObject(row) ||
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
            (row.canOpen && (value.source !== "app" || !APP_SESSION_ID.test(row.id)))) {
            return false;
        }
        ids.add(row.id);
        return true;
    });
}
