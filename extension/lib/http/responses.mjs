import { ERROR_CODES, HTTP_STATUS_BY_CODE, SEND_STATUS } from "../../shared/contract.mjs";
import { SENSITIVE_RESPONSE_HEADERS } from "../../shared/security.mjs";
export const statusFor = (code) => HTTP_STATUS_BY_CODE[code] ?? 500;
export const errorMessage = (error) => error instanceof Error ? error.message : "error";
export function baseHeaders(contentType) {
    return { ...SENSITIVE_RESPONSE_HEADERS, ...(contentType ? { "content-type": contentType } : {}) };
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
export function sendError(res, code, message, status = "error", extra) {
    sendJson(res, statusFor(code), { ok: false, status, code, message }, extra);
}
export function sendRejected(res, code, message, extra) {
    sendError(res, code, message, SEND_STATUS.rejected, extra);
}
export function notAllowed(res, allow) {
    sendError(res, ERROR_CODES.methodNotAllowed, "Method not allowed.", "error", { allow });
}
