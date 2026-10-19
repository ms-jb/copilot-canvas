import { createHash } from "node:crypto";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { ERROR_CODES, HTTP_STATUS_BY_CODE, SEND_STATUS } from "../../shared/contract.mts";
import { SENSITIVE_RESPONSE_HEADERS } from "../../shared/node/security.mts";

export const statusFor = (code: string): number => HTTP_STATUS_BY_CODE[code] ?? 500;
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "error";

export function baseHeaders(contentType?: string): OutgoingHttpHeaders {
  return { ...SENSITIVE_RESPONSE_HEADERS, ...(contentType ? { "content-type": contentType } : {}) };
}
/** Headers for a cacheable static file: the safe defaults with its own Cache-Control. */
export function cacheHeaders(
  contentType: string,
  cacheControl: string,
  etag: string,
): OutgoingHttpHeaders {
  const { pragma: _pragma, ...headers } = baseHeaders(contentType);
  return { ...headers, "cache-control": cacheControl, etag };
}
/** A weak ETag for a file version. */
export const fileEtag = ({ size, mtimeMs }: { size: number; mtimeMs: number }): string =>
  `W/"${size.toString(36)}-${Math.trunc(mtimeMs).toString(36)}"`;
/** Answers 304 when the request's If-None-Match already names the response's ETag. */
export function notModified(
  req: IncomingMessage,
  res: ServerResponse,
  headers: OutgoingHttpHeaders,
): boolean {
  const header = req.headers["if-none-match"];
  if (typeof header !== "string") return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, "");
  const etag = strip(String(headers.etag));
  if (!header.split(",").some((tag) => tag.trim() === "*" || strip(tag) === etag)) return false;
  res.writeHead(304, headers);
  res.end();
  return true;
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
/**
 * Sends a GET body that may be reused: `private, no-cache` plus an ETag over the serialized body,
 * so the browser (or the gateway) revalidates cheaply and gets a 304 when nothing changed.
 * Anything sensitive (bootstrap, CSRF) keeps using `sendJson` and its `no-store`.
 */
export function sendReadJson(res: ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body);
  const etag = `"${createHash("sha1").update(payload).digest("base64url").slice(0, 22)}"`;
  const { pragma: _pragma, ...safe } = baseHeaders("application/json; charset=utf-8");
  const headers: OutgoingHttpHeaders = {
    ...safe,
    "cache-control": "private, no-cache",
    etag,
  };
  if (res.req && notModified(res.req, res, headers)) return;
  res.writeHead(200, { ...headers, "content-length": Buffer.byteLength(payload) });
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
