// Request validation shared by the provider and the gateway: Host/Origin allow-lists,
// constant-time comparison and a few small helpers. Node only, no I/O.
import { timingSafeEqual } from "node:crypto";
export function loopbackHost(port) {
    return `127.0.0.1:${port}`;
}
export function loopbackOrigin(port) {
    return `http://127.0.0.1:${port}`;
}
/** Exact, case-insensitive match of the Host header against an allow-list. */
export function isAllowedHost(hostHeader, allowedHosts) {
    if (typeof hostHeader !== "string" || hostHeader.length === 0 || hostHeader.length > 255) {
        return false;
    }
    const host = hostHeader.toLowerCase();
    return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}
/** Exact match of an Origin header against an allow-list. "null" and malformed values never match. */
export function isAllowedOrigin(originHeader, allowedOrigins) {
    if (typeof originHeader !== "string" || originHeader.length === 0)
        return false;
    return allowedOrigins.some((allowed) => allowed !== "" && allowed === originHeader);
}
/**
 * Checks Origin for a request.
 * - Unsafe methods (anything but GET/HEAD) must carry an allowed Origin.
 * - Safe methods may omit Origin (same-origin navigations do) but a present Origin must be allowed.
 * - If the browser sent Sec-Fetch-Site on an unsafe request, it must be same-origin.
 */
export function checkOrigin(input) {
    const { method, headers, allowedOrigins } = input;
    const origin = headers.origin;
    const unsafe = method !== "GET" && method !== "HEAD";
    if (origin === undefined) {
        return !unsafe;
    }
    if (!isAllowedOrigin(origin, allowedOrigins))
        return false;
    if (unsafe) {
        const site = headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin")
            return false;
    }
    return true;
}
export function timingSafeEqualStrings(a, b) {
    if (typeof a !== "string" || typeof b !== "string")
        return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
}
/** True when the Content-Type is application/json (parameters such as charset allowed). */
export function isJsonContentType(value) {
    return typeof value === "string" && /^application\/json\s*(;|$)/i.test(value);
}
export const SENSITIVE_RESPONSE_HEADERS = Object.freeze({
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
});
