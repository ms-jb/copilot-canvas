import http from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { API, ERROR_CODES, LIMITS } from "../../src/shared/contract.mts";
import type { ProviderState } from "../../src/shared/node/runtime-state.mts";
import { SENSITIVE_RESPONSE_HEADERS } from "../../src/shared/node/security.mts";
import type { SelectProvider } from "./provider-discovery.mts";
import { FORWARDED_HEADERS, LOOPBACK } from "./request-policy.mts";
import { sendError, sendNotConnected } from "./http.mts";

const WATCH_INTERVAL_MS = 500;
const UPSTREAM_TIMEOUT_MS = LIMITS.sendTimeoutMs + 5000;

export function createProxy(selectProvider: SelectProvider) {
  return function forward(
    request: IncomingMessage,
    response: ServerResponse,
    state: ProviderState,
    path: string,
    body?: Buffer,
  ) {
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
        for (const name of [
          "connection",
          "keep-alive",
          "transfer-encoding",
          "set-cookie",
          "server",
        ]) {
          delete out[name];
        }
        for (const name of Object.keys(out)) {
          if (name.startsWith("access-control-")) delete out[name];
        }
        out["x-content-type-options"] = "nosniff";
        // Static assets may keep the provider's caching headers; everything else is never cached.
        const keepCaching =
          (path.startsWith("assets/") ||
            path === "apple-touch-icon.png" ||
            path === "apple-touch-icon-precomposed.png") &&
          reply.statusCode === 200 &&
          out["cache-control"];
        if (!keepCaching) Object.assign(out, SENSITIVE_RESPONSE_HEADERS);

        const isSse =
          isEvents && (reply.headers["content-type"]?.startsWith("text/event-stream") ?? false);
        if (isSse) {
          out["x-accel-buffering"] = "no";
          request.socket.setNoDelay(true);
        }
        response.writeHead(reply.statusCode ?? 502, out);
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
