// POST /api/push/notify: lets a local tool (`npm run notify`) push an arbitrary notice to every
// subscribed phone. Not part of the proxied ROUTES and never reachable from the page: it accepts
// only loopback connections that carry no browser or tunnel headers, and the bearer token from
// the private notify-token file is the real gate (tunnel traffic also arrives from loopback).
import type { IncomingMessage, ServerResponse } from "node:http";
import { ERROR_CODES } from "../../src/shared/contract.mts";
import {
  isAllowedHost,
  isJsonContentType,
  timingSafeEqualStrings,
} from "../../src/shared/node/security.mts";
import type { Notice } from "../push/notifications.mts";
import { readBody, sendError, sendJson } from "./http.mts";
import type { PushState } from "./push-state.mts";

export const NOTIFY_PATH = "/api/push/notify";
const NOTIFY_LIMITS = Object.freeze({ title: 80, body: 300, url: 500, bodyBytes: 4096 });

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// Browsers send Origin, Referer, cookies or Sec-Fetch-*; the dev tunnel adds forwarding headers.
const FOREIGN_HEADER =
  /^(?:origin|referer|cookie|via|forwarded|sec-fetch-.*|x-forwarded-.*|x-ms-.*)$/;
// C0/C1 controls, line/paragraph separators and bidi overrides that could disguise the text.
const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;
const FIELDS = new Set(["title", "body", "url"]);

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || UNSAFE_TEXT.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** Same-origin absolute path ("/x", not "//host") or an http(s) URL. */
function link(value: string): boolean {
  if (value.length > NOTIFY_LIMITS.url || /[\s\\]/.test(value) || UNSAFE_TEXT.test(value)) {
    return false;
  }
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The notice to push, or an error message for the caller. */
export function parseNotice(value: unknown): Notice | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Expected a JSON object.";
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !FIELDS.has(key))) return "Only title, body and url.";
  const title = text(fields.title, NOTIFY_LIMITS.title);
  if (!title)
    return `title must be 1-${NOTIFY_LIMITS.title} characters without control characters.`;
  const body = text(fields.body, NOTIFY_LIMITS.body);
  if (!body) return `body must be 1-${NOTIFY_LIMITS.body} characters without control characters.`;
  if (fields.url === undefined) return { title, body };
  if (typeof fields.url !== "string" || !link(fields.url)) {
    return `url must be a path starting with / or an http(s) URL, at most ${NOTIFY_LIMITS.url} characters.`;
  }
  return { title, body, url: fields.url };
}

export function isLocalToolRequest(request: IncomingMessage, port: number): boolean {
  return (
    LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? "") &&
    isAllowedHost(request.headers.host, [`127.0.0.1:${port}`, `localhost:${port}`]) &&
    !Object.keys(request.headers).some((name) => FOREIGN_HEADER.test(name))
  );
}

export function createNotifyRoute(push: PushState, token: string, port: () => number) {
  let sequence = 0;

  return async function handleNotify(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "POST") {
      return sendError(request, response, ERROR_CODES.methodNotAllowed, "Method not allowed.");
    }
    const bearer = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
    if (!isLocalToolRequest(request, port()) || !timingSafeEqualStrings(bearer, token)) {
      return sendError(request, response, ERROR_CODES.forbidden, "Forbidden.");
    }
    if (!isJsonContentType(request.headers["content-type"])) {
      return sendError(request, response, ERROR_CODES.unsupportedMediaType, "Expected JSON.");
    }
    const body = await readBody(request, NOTIFY_LIMITS.bodyBytes);
    if (!body) {
      return sendError(
        request,
        response,
        ERROR_CODES.payloadTooLarge,
        "Request body is too large.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return sendError(request, response, ERROR_CODES.badRequest, "Malformed JSON.");
    }
    const notice = parseNotice(parsed);
    if (typeof notice === "string") {
      return sendError(request, response, ERROR_CODES.badRequest, notice);
    }

    // An explicit notice goes to every device, focused or not, under its own tag.
    push.latest = { ...notice, tag: `notice-${Date.now()}-${++sequence}` };
    const total = push.store.endpoints().length;
    const sent = await push.store.sendAll();
    sendJson(response, 200, { ok: true, sent, failed: total - sent });
  };
}
