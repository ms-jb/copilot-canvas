import http from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { API, ERROR_CODES, LIMITS } from "../../src/shared/contract.mts";
import type { ProviderState } from "../../src/shared/node/runtime-state.mts";
import { SENSITIVE_RESPONSE_HEADERS } from "../../src/shared/node/security.mts";
import type { SelectProvider } from "./provider-discovery.mts";
import { FORWARDED_HEADERS, LOOPBACK } from "./request-policy.mts";
import { sendError, sendNotConnected } from "./http.mts";
import type { CachedReply } from "./get-cache.mts";
import { createGetCache, isGetCached, isStorable } from "./get-cache.mts";

const WATCH_INTERVAL_MS = 500;
const UPSTREAM_TIMEOUT_MS = LIMITS.sendTimeoutMs + 5000;

const CACHEABLE_STATUS = new Set([200, 206, 304]);

/**
 * True when the provider's own Cache-Control stays: static files, and JSON reads it marked
 * `private, no-cache` with an ETag (the browser revalidates and gets a 304). Anything else is
 * never cached.
 */
function keepsCaching(
  method: string | undefined,
  path: string,
  status: number | undefined,
  headers: OutgoingHttpHeaders,
) {
  if (!CACHEABLE_STATUS.has(status ?? 0) || headers["cache-control"] === undefined) return false;
  const isStatic =
    path === "" ||
    path.startsWith("assets/") ||
    path === "apple-touch-icon.png" ||
    path === "apple-touch-icon-precomposed.png";
  return (
    isStatic ||
    (method === "GET" && headers["cache-control"] === "private, no-cache" && !!headers.etag)
  );
}

const PRIVATE_HEADERS = ["connection", "keep-alive", "transfer-encoding", "set-cookie", "server"];

/** Answers from a stored reply, as a 304 when the request already has this ETag. */
function serveCached(request: IncomingMessage, response: ServerResponse, reply: CachedReply) {
  const tags = String(request.headers["if-none-match"] ?? "");
  const match = tags.split(",").some((tag) => tag.trim() === reply.headers.etag);
  if (match) {
    const { "content-length": _length, "content-type": _type, ...headers } = reply.headers;
    response.writeHead(304, headers);
    response.end();
  } else {
    response.writeHead(200, reply.headers);
    response.end(reply.body);
  }
}

export function createProxy(selectProvider: SelectProvider) {
  const replies = createGetCache();
  return function forward(
    request: IncomingMessage,
    response: ServerResponse,
    state: ProviderState,
    path: string,
    body?: Buffer,
  ) {
    if (request.method === "GET" && isGetCached(path)) {
      const kept = replies.get(state.generation, path);
      if (kept) return serveCached(request, response, kept);
    } else if (request.method === "POST") {
      replies.clear(path);
    }
    const target = new URL(state.origin);
    const isEvents = path === API.events;
    const headers: OutgoingHttpHeaders = {
      host: target.host,
      origin: target.origin,
      connection: "close",
    };
    for (const name of FORWARDED_HEADERS) {
      if (request.headers[name] !== undefined) headers[name] = request.headers[name];
    }
    if (body) headers["content-length"] = body.length;

    const upstream = http.request(
      {
        host: LOOPBACK,
        port: target.port,
        method: request.method,
        path: state.capabilityPath + path,
        agent: false,
        headers,
        timeout: isEvents ? 0 : UPSTREAM_TIMEOUT_MS,
      },
      (reply) => {
        const out: OutgoingHttpHeaders = { ...reply.headers };
        for (const name of PRIVATE_HEADERS) delete out[name];
        for (const name of Object.keys(out)) {
          if (name.startsWith("access-control-")) delete out[name];
        }
        out["x-content-type-options"] = "nosniff";
        // The page and static assets may keep the provider's caching headers, and JSON reads the
        // provider marked for revalidation; everything else is never cached.
        if (keepsCaching(request.method, path, reply.statusCode, out)) {
          const { "cache-control": _cache, pragma: _pragma, ...rest } = SENSITIVE_RESPONSE_HEADERS;
          Object.assign(out, rest);
        } else {
          Object.assign(out, SENSITIVE_RESPONSE_HEADERS);
        }

        const isSse =
          isEvents && (reply.headers["content-type"]?.startsWith("text/event-stream") ?? false);
        if (isSse) {
          out["x-accel-buffering"] = "no";
          request.socket.setNoDelay(true);
        }
        response.writeHead(reply.statusCode ?? 502, out);
        if (request.method === "GET" && isGetCached(path) && isStorable(reply.statusCode, out)) {
          const chunks: Buffer[] = [];
          reply.on("data", (chunk: Buffer) => chunks.push(chunk));
          reply.on("end", () => {
            if (reply.complete) replies.set(state.generation, path, out, Buffer.concat(chunks));
          });
        }
        reply.on("error", () => {
          if (!isSse) response.destroy();
        });
        reply.pipe(response);
        if (!isSse) return;

        response.flushHeaders();
        // End the stream when the selected provider changes (restart, another session's canvas
        // opened more recently) or disappears.
        const watcher = setInterval(() => {
          void selectProvider().then((current) => {
            if (current?.generation !== state.generation) upstream.destroy();
          });
        }, WATCH_INTERVAL_MS);
        upstream.on("close", () => {
          clearInterval(watcher);
          response.end();
        });
        response.on("close", () => clearInterval(watcher));
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (response.headersSent) return;
      // A refused connection never reached the provider; any other send failure is an unknown outcome.
      if (request.method === "POST" && error.code !== "ECONNREFUSED") {
        if (path === API.controls) {
          sendError(
            request,
            response,
            ERROR_CODES.controlFailed,
            "The change may not have applied.",
          );
        } else if (path === API.respond) {
          sendError(
            request,
            response,
            ERROR_CODES.respondUncertain,
            "The answer may not have reached the session. Check before answering again.",
          );
        } else {
          sendError(
            request,
            response,
            ERROR_CODES.sendUncertain,
            "The outcome of the send is unknown.",
          );
        }
      } else {
        sendNotConnected(request, response, path === "");
      }
    });
    response.on("close", () => upstream.destroy());
    upstream.end(body);
  };
}
