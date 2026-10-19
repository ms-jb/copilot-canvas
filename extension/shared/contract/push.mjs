import { ERROR_CODES } from "./errors.mjs";
import { isPlainObject, makeError, onlyKeys } from "./validation.mjs";
export const ACTIVE_HOURS_DEFAULT = Object.freeze({
    days: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "17:00",
});
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ACTIVE_HOURS_KEYS = ["on", "days", "start", "end", "zone"];
const formatters = new Map();
function minutesOf(value) {
    const match = CLOCK.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}
function zoneFormatter(zone) {
    const known = formatters.get(zone);
    if (known)
        return known;
    try {
        const made = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        formatters.set(zone, made);
        return made;
    }
    catch {
        return null;
    }
}
/** The runtime's current IANA time zone, or "" when it can't be read. */
export function deviceTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    }
    catch {
        return "";
    }
}
/** Complete, valid active hours, or null when `value` isn't one. */
export function normalizeActiveHours(value) {
    if (!isPlainObject(value) || !onlyKeys(value, ACTIVE_HOURS_KEYS))
        return null;
    const { on, days, start, end, zone } = value;
    if (typeof on !== "boolean" || !Array.isArray(days) || days.length === 0 || days.length > 7) {
        return null;
    }
    if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))
        return null;
    if (typeof start !== "string" || typeof end !== "string" || typeof zone !== "string")
        return null;
    if (Number.isNaN(minutesOf(start)) || Number.isNaN(minutesOf(end)) || start === end)
        return null;
    if (!zone || zone.length > 64 || !zoneFormatter(zone))
        return null;
    return {
        on,
        days: [...new Set(days)].sort((a, b) => a - b),
        start,
        end,
        zone,
    };
}
/** True when notifications should be sent for this active-hours setting at `at`. */
export function isWithinActiveHours(value, at = new Date()) {
    const hours = normalizeActiveHours(value);
    if (!hours?.on)
        return true;
    const format = zoneFormatter(hours.zone);
    if (!format)
        return true;
    const parts = format.formatToParts(at);
    const day = DAY_NAMES.indexOf(parts.find((part) => part.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (day < 0 || Number.isNaN(hour) || Number.isNaN(minute))
        return true;
    const now = hour * 60 + minute;
    const start = minutesOf(hours.start);
    const end = minutesOf(hours.end);
    if (start < end)
        return hours.days.includes(day) && now >= start && now < end;
    return ((hours.days.includes(day) && now >= start) || (hours.days.includes((day + 6) % 7) && now < end));
}
/** Strict validation for POST api/push/settings. */
export function validatePushSettingsPayload(body) {
    if (!isPlainObject(body) || !onlyKeys(body, ["endpoint", "activeHours"])) {
        return makeError(ERROR_CODES.badRequest, "Body must be { endpoint, activeHours }.");
    }
    if (typeof body.endpoint !== "string" || body.endpoint.length === 0) {
        return makeError(ERROR_CODES.badRequest, "endpoint is required.");
    }
    const activeHours = normalizeActiveHours(body.activeHours);
    if (!activeHours) {
        return makeError(ERROR_CODES.badRequest, "activeHours is invalid.");
    }
    return { ok: true, value: { endpoint: body.endpoint, activeHours } };
}
