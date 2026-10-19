import { createHash } from "node:crypto";
import { ERROR_CODES, HTTP_STATUS_BY_CODE, SEND_STATUS } from "../../shared/contract.mjs";
import { SENSITIVE_RESPONSE_HEADERS } from "../../shared/node/security.mjs";
export const statusFor = (code) => HTTP_STATUS_BY_CODE[code] ?? 500;
export const errorMessage = (error) => error instanceof Error ? error.message : "error";
export function baseHeaders(contentType) {
    return { ...SENSITIVE_RESPONSE_HEADERS, ...(contentType ? { "content-type": contentType } : {}) };
}
/** Headers for a cacheable static file: the safe defaults with its own Cache-Control. */
export function cacheHeaders(contentType, cacheControl, etag) {
    const { pragma: _pragma, ...headers } = baseHeaders(contentType);
    return { ...headers, "cache-control": cacheControl, etag };
}
/** A weak ETag for a file version. */
export const fileEtag = ({ size, mtimeMs }) => `W/"${size.toString(36)}-${Math.trunc(mtimeMs).toString(36)}"`;
/** Answers 304 when the request's If-None-Match already names the response's ETag. */
export function notModified(req, res, headers) {
    const header = req.headers["if-none-match"];
    if (typeof header !== "string")
        return false;
    const strip = (tag) => tag.trim().replace(/^W\//, "");
    const etag = strip(String(headers.etag));
    if (!header.split(",").some((tag) => tag.trim() === "*" || strip(tag) === etag))
        return false;
    res.writeHead(304, headers);
    res.end();
    return true;
}
export function sendJson(res, status, body, extra = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        ...baseHeaders("application/json; charset=utf-8"),
        "content-length": Buffer.byteLength(payload),
        ...extra,
    });
    res.end(payload);
}
/**
 * Sends a GET body that may be reused: `private, no-cache` plus an ETag over the serialized body,
 * so the browser (or the gateway) revalidates cheaply and gets a 304 when nothing changed.
 * Anything sensitive (bootstrap, CSRF) keeps using `sendJson` and its `no-store`.
 */
export function sendReadJson(res, body) {
    const payload = JSON.stringify(body);
    const etag = `"${createHash("sha1").update(payload).digest("base64url").slice(0, 22)}"`;
    const { pragma: _pragma, ...safe } = baseHeaders("application/json; charset=utf-8");
    const headers = {
        ...safe,
        "cache-control": "private, no-cache",
        etag,
    };
    if (res.req && notModified(res.req, res, headers))
        return;
    res.writeHead(200, { ...headers, "content-length": Buffer.byteLength(payload) });
    res.end(payload);
}
export function sendError(res, code, message, status = "error", extra) {
    sendJson(res, statusFor(code), { ok: false, status, code, message }, extra);
}
export function sendRejected(res, code, message, extra) {
    sendError(res, code, message, SEND_STATUS.rejected, extra);
}
export function notAllowed(res, allow) {
    sendError(res, ERROR_CODES.methodNotAllowed, "Method not allowed.", "error", { allow });
}
