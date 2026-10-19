import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { API, ERROR_CODES, normalizeActiveHours } from "../../src/shared/contract.mts";
import { SENSITIVE_RESPONSE_HEADERS, isJsonContentType } from "../../src/shared/node/security.mts";
import { isAllowedPushEndpoint } from "../push/web-push.mts";
import { readBody, sendError, sendJson } from "./http.mts";
import type { PushState } from "./push-state.mts";

const PUSH_TEST_INTERVAL_MS = 5000;
const PUSH_BODY_MAX_BYTES = 4096;
const SERVICE_WORKER = readFileSync(new URL("../sw.js", import.meta.url));

export function createPushRoutes(push: PushState) {
  let lastTestAt = -Infinity;

  /** Gateway-local notification routes. Returns false for any other path. */
  return async function handlePush(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    method: string,
  ): Promise<boolean> {
    const path = pathname.slice(1);
    const reads = new Map<string, () => void>([
      [
        "sw.js",
        () => {
          response.writeHead(200, {
            ...SENSITIVE_RESPONSE_HEADERS,
            "content-type": "text/javascript; charset=utf-8",
            "content-length": SERVICE_WORKER.length,
          });
          response.end(SERVICE_WORKER);
        },
      ],
      [API.pushKey, () => sendJson(response, 200, { publicKey: push.store.publicKey })],
      [API.pushLatest, () => sendJson(response, 200, push.latest ?? push.fallback)],
    ]);
    const writes = new Set<string>([
      API.pushSubscribe,
      API.pushUnsubscribe,
      API.pushSettings,
      API.pushTest,
      API.pushPresence,
    ]);
    const read = reads.get(path);
    if (!read && !writes.has(path)) return false;
    const expected = read ? "GET" : "POST";
    if (method !== expected) {
      sendError(request, response, ERROR_CODES.methodNotAllowed, "Method not allowed.");
      return true;
    }
    if (read) {
      read();
      return true;
    }

    if (!isJsonContentType(request.headers["content-type"])) {
      sendError(request, response, ERROR_CODES.unsupportedMediaType, "Expected JSON.");
      return true;
    }
    const body = await readBody(request, PUSH_BODY_MAX_BYTES);
    let fields: { endpoint?: unknown; focused?: unknown; activeHours?: unknown } = {};
    try {
      const parsed: unknown = body ? JSON.parse(body.toString("utf8")) : null;
      if (parsed && typeof parsed === "object") fields = parsed;
    } catch {
      // Malformed JSON leaves no endpoint, which is rejected below.
    }
    const { endpoint } = fields;
    if (path === API.pushTest) {
      const now = Date.now();
      if (now - lastTestAt < PUSH_TEST_INTERVAL_MS) {
        sendError(request, response, ERROR_CODES.badRequest, "Wait a few seconds and try again.");
        return true;
      }
      lastTestAt = now;
      push.latest = { title: push.fallback.title, body: "Notifications are on." };
      sendJson(response, 200, {
        ok: true,
        sent: await push.store.sendAll({ ignoreActiveHours: true }),
      });
      return true;
    }
    if (!isAllowedPushEndpoint(endpoint)) {
      sendError(request, response, ERROR_CODES.badRequest, "Not a supported push service.");
      return true;
    }
    if (path === API.pushSettings) {
      if (!push.store.endpoints().includes(endpoint)) {
        sendError(request, response, ERROR_CODES.badRequest, "Not a subscribed device.");
        return true;
      }
      // Without activeHours this reads the saved setting; with it, replaces it.
      if (fields.activeHours === undefined) {
        sendJson(response, 200, { ok: true, activeHours: push.store.activeHours(endpoint) });
        return true;
      }
      const activeHours = normalizeActiveHours(fields.activeHours);
      if (!activeHours || !push.store.setActiveHours(endpoint, activeHours)) {
        sendError(request, response, ERROR_CODES.badRequest, "Invalid active hours.");
        return true;
      }
      sendJson(response, 200, { ok: true, activeHours });
      return true;
    }
    if (path === API.pushPresence) {
      // Only subscribed devices are tracked, which also caps the map at the subscription limit.
      if (typeof fields.focused !== "boolean" || !push.store.endpoints().includes(endpoint)) {
        sendError(request, response, ERROR_CODES.badRequest, "Not a subscribed device.");
        return true;
      }
      push.presence.report(endpoint, fields.focused);
      sendJson(response, 200, { ok: true });
      return true;
    }
    if (path === API.pushSubscribe) {
      const activeHours =
        fields.activeHours === undefined ? undefined : normalizeActiveHours(fields.activeHours);
      if (fields.activeHours !== undefined && !activeHours) {
        sendError(request, response, ERROR_CODES.badRequest, "Invalid active hours.");
        return true;
      }
      push.store.add(endpoint, activeHours ? { activeHours } : undefined);
    } else {
      push.store.remove(endpoint);
      push.presence.forget(endpoint);
    }
    sendJson(response, 200, { ok: true });
    return true;
  };
}
