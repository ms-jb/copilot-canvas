import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { API, ATTACHMENT_LIMITS, ERROR_CODES, LIMITS } from "../../src/shared/contract.mts";
import { createProviderSelector } from "./provider-discovery.mts";
import { createProxy } from "./proxy.mts";
import { createPushRoutes } from "./push-routes.mts";
import { createPushState } from "./push-state.mts";
import type { PushOptions } from "./push-state.mts";
import { watchPush } from "./push-watcher.mts";
import {
  LOOPBACK,
  PINNED_WRITES,
  acceptsRequest,
  allowedMethod,
  isStale,
} from "./request-policy.mts";
import { readBody, sendError, sendNotConnected } from "./http.mts";

export interface GatewayOptions {
  /** Port on 127.0.0.1; 0 picks a free one. Defaults to 47600. */
  port?: number;
  /** Exact extra Origin to accept, for example the tunnel's https origin. */
  allowedOrigin?: string;
  /** Directory of per-session provider state files; the most recently opened live one is used. */
  sessionsDir?: string;
  /** A single provider state file to use instead of scanning `sessionsDir`. */
  statePath?: string;
  /** Phone notifications: the private file for keys and subscriptions. Omit to turn them off. */
  push?: PushOptions;
}

export interface Gateway {
  server: http.Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createGateway(options: GatewayOptions): Gateway {
  const server = http.createServer((request, response) => void handle(request, response));
  const port = () => (server.address() as AddressInfo).port;
  const selectProvider = createProviderSelector(options);
  const forward = createProxy(selectProvider);
  const push = options.push && createPushState(options.push);
  const handlePush = push && createPushRoutes(push);
  const stopPush = push && watchPush(push, selectProvider);

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    if (!acceptsRequest(request, port(), options.allowedOrigin ?? "")) {
      return sendError(request, response, ERROR_CODES.forbidden, "Forbidden.");
    }

    // Query strings are dropped; encoded or relative path tricks never match the allow-list.
    const pathname = (request.url ?? "").split("?")[0] ?? "";
    if (handlePush && (await handlePush(request, response, pathname, method))) return;
    const expected = allowedMethod(pathname);
    if (!expected) return sendError(request, response, ERROR_CODES.notFound, "Not found.");
    if (expected !== method) {
      return sendError(request, response, ERROR_CODES.methodNotAllowed, "Method not allowed.");
    }
    const path = pathname.slice(1);
    const state = await selectProvider();
    if (!state) return sendNotConnected(request, response, path === "");

    // Pages always send their generation on writes; refuse a different provider run.
    if (isStale(request, path, state.generation)) {
      return sendError(
        request,
        response,
        ERROR_CODES.staleProvider,
        "Out of date. Reload to reconnect.",
      );
    }
    let body: Buffer | undefined;
    if (PINNED_WRITES.has(path)) {
      const read = await readBody(
        request,
        path === API.send ? ATTACHMENT_LIMITS.maxSendBodyBytes : LIMITS.maxBodyBytes,
      );
      if (!read)
        return sendError(
          request,
          response,
          ERROR_CODES.payloadTooLarge,
          "Request body is too large.",
        );
      body = read;
    }
    forward(request, response, state, path, body);
  }

  return {
    server,
    listen: () =>
      new Promise((done, fail) => {
        server.once("error", fail);
        server.listen({ port: options.port ?? 47600, host: LOOPBACK }, () =>
          done({ port: port() }),
        );
      }),
    close: () =>
      new Promise((done) => {
        stopPush?.();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
