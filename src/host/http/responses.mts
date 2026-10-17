import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { ERROR_CODES, HTTP_STATUS_BY_CODE, SEND_STATUS } from "../../shared/contract.mts";
import { SENSITIVE_RESPONSE_HEADERS } from "../../shared/node/security.mts";

export const statusFor = (code: string): number => HTTP_STATUS_BY_CODE[code] ?? 500;
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "error";

export function baseHeaders(contentType?: string): OutgoingHttpHeaders {
  return { ...SENSITIVE_RESPONSE_HEADERS, ...(contentType ? { "content-type": contentType } : {}) };
}
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: OutgoingHttpHeaders = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...baseHeaders("application/json; charset=utf-8"),
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
}
export function sendError(
  res: ServerResponse,
  code: string,
  message: string,
  status: string = "error",
  extra?: OutgoingHttpHeaders,
): void {
  sendJson(res, statusFor(code), { ok: false, status, code, message }, extra);
}
export function sendRejected(
  res: ServerResponse,
  code: string,
  message: string,
  extra?: OutgoingHttpHeaders,
): void {
  sendError(res, code, message, SEND_STATUS.rejected, extra);
}
export function notAllowed(res: ServerResponse, allow: string): void {
  sendError(res, ERROR_CODES.methodNotAllowed, "Method not allowed.", "error", { allow });
}
