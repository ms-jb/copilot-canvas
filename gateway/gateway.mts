// Loopback gateway: lets a remote browser (for example through an owner-only dev tunnel) reach the
// extension's provider without exposing its capability path. Binds 127.0.0.1 only and never
// forwards anything outside the allow-list below. It never logs request data.
// Every Copilot session with the extension loaded publishes its own provider state file; the
// gateway follows the live one whose canvas was opened most recently.

import { rmSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import qrcode from "qrcode-generator";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  API,
  ERROR_CODES,
  HEADERS,
  HTTP_STATUS_BY_CODE,
  LIMITS,
  validateIdentity,
} from "../extension-src/shared/contract.mts";
import { gatewayStatePath, loadConfig, sessionsDir } from "../extension-src/shared/config.mts";
import {
  buildGatewayState,
  readGatewayState,
  readLiveProviders,
  readProviderState,
  writePrivateJson,
} from "../extension-src/shared/runtime-state.mts";
import type { ProviderState } from "../extension-src/shared/runtime-state.mts";
import {
  SENSITIVE_RESPONSE_HEADERS,
  checkOrigin,
  isAllowedHost,
} from "../extension-src/shared/security.mts";

const LOOPBACK = "127.0.0.1";
const WATCH_INTERVAL_MS = 500;
// Provider selection (file scan + identity probe) is reused for this long.
const SELECTION_TTL_MS = 500;
const UPSTREAM_TIMEOUT_MS = LIMITS.sendTimeoutMs + 5000;

// Only these request headers reach the provider (no cookies, authorization or x-forwarded-*).
const FORWARDED_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  HEADERS.csrf,
  HEADERS.generation,
];

const ASSET_PATH = /^\/assets\/(?:[A-Za-z0-9._~@-]+\/)*[A-Za-z0-9._~@-]+$/;
const ROUTES: Record<string, string> = {
  "/": "GET",
  [`/${API.identity}`]: "GET",
  [`/${API.bootstrap}`]: "GET",
  [`/${API.events}`]: "GET",
  [`/${API.send}`]: "POST",
  [`/${API.controls}`]: "POST",
  [`/${API.respond}`]: "POST",
  [`/${API.share}`]: "GET",
};
// Writes must be pinned to the provider run the page was loaded from.
const PINNED_WRITES = new Set<string>([API.send, API.controls, API.respond]);

const NOT_CONNECTED_PAGE = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Not connected</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color-scheme:light dark}</style>
<h1>Not connected</h1>
<p>Copilot Canvas isn't running. Open the canvas in a Copilot chat and this page reconnects on its own.</p>
`;

export interface GatewayOptions {
  /** Port on 127.0.0.1; 0 picks a free one. Defaults to 47600. */
  port?: number;
  /** Exact extra Origin to accept, for example the tunnel's https origin. */
  allowedOrigin?: string;
  /** Directory of per-session provider state files; the most recently opened live one is used. */
  sessionsDir?: string;
  /** A single provider state file to use instead of scanning `sessionsDir`. */
  statePath?: string;
}

export interface Gateway {
  server: http.Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

/** True when the provider in the state file answers the identity route with the same generation. */
function probeIdentity(state: ProviderState): Promise<boolean> {
  return new Promise((done) => {
    const probe = http.get(
      {
        host: LOOPBACK,
        port: new URL(state.origin).port,
        path: state.capabilityPath + API.identity,
        agent: false,
        timeout: 1500,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", () => done(false));
        response.on("end", () => {
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            done(validateIdentity(body) && body.generation === state.generation);
          } catch {
            done(false);
          }
        });
      },
    );
    probe.on("timeout", () => probe.destroy());
    probe.on("error", () => done(false));
  });
}

/** Reads the body, or resolves null when it exceeds `maxBytes` or the client goes away. */
function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) done(null);
      else chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", () => done(null));
  });
}

export function createGateway(options: GatewayOptions): Gateway {
  const { statePath, sessionsDir: stateDir, allowedOrigin = "" } = options;
  const server = http.createServer((request, response) => void handle(request, response));
  const port = () => (server.address() as AddressInfo).port;

  function candidates(): ProviderState[] {
    if (statePath) {
      const state = readProviderState(statePath);
      return state ? [state] : [];
    }
    return stateDir ? readLiveProviders(stateDir) : [];
  }

  let selection: { at: number; result: Promise<ProviderState | null> } | null = null;

  /** The most recently opened provider that answers its identity probe with its own generation. */
  function selectProvider(): Promise<ProviderState | null> {
    const now = Date.now();
    if (selection && now - selection.at < SELECTION_TTL_MS) return selection.result;
    const result = (async () => {
      for (const state of candidates()) {
        if (await probeIdentity(state)) return state;
      }
      return null;
    })();
    selection = { at: now, result };
    return result;
  }

  function sendError(
    request: IncomingMessage,
    response: ServerResponse,
    code: string,
    message: string,
  ) {
    const isPost = request.method === "POST";
    const isSend = isPost && request.url?.split("?")[0] === `/${API.send}`;
    const body = Buffer.from(
      JSON.stringify({
        ok: false,
        code,
        message,
        ...(isSend && { status: code === ERROR_CODES.sendUncertain ? "uncertain" : "rejected" }),
      }),
    );
    const headers: OutgoingHttpHeaders = {
      ...SENSITIVE_RESPONSE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
    };
    if (isPost) {
      // The request body may be unread: discard it and close the connection after replying.
      headers.connection = "close";
      request.resume();
    }
    response.writeHead(HTTP_STATUS_BY_CODE[code] ?? 500, headers);
    response.end(body);
  }

  function sendNotConnected(request: IncomingMessage, response: ServerResponse, isIndex: boolean) {
    if (!isIndex)
      return sendError(request, response, ERROR_CODES.notConnected, "Provider not connected.");
    response.writeHead(503, {
      ...SENSITIVE_RESPONSE_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    });
    response.end(NOT_CONNECTED_PAGE);
  }

  function forward(
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
          path.startsWith("assets/") && reply.statusCode === 200 && out["cache-control"];
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
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    if (
      !isAllowedHost(request.headers.host, [`127.0.0.1:${port()}`, `localhost:${port()}`]) ||
      !checkOrigin({
        method,
        headers: request.headers,
        allowedOrigins: [`http://127.0.0.1:${port()}`, `http://localhost:${port()}`, allowedOrigin],
      })
    ) {
      return sendError(request, response, ERROR_CODES.forbidden, "Forbidden.");
    }

    // Query strings are dropped; encoded or relative path tricks never match the allow-list.
    const pathname = (request.url ?? "").split("?")[0] ?? "";
    const isAsset = ASSET_PATH.test(pathname) && !pathname.split("/").includes("..");
    const allowedMethod = isAsset ? "GET" : ROUTES[pathname];
    if (!allowedMethod) return sendError(request, response, ERROR_CODES.notFound, "Not found.");
    if (allowedMethod !== method) {
      return sendError(request, response, ERROR_CODES.methodNotAllowed, "Method not allowed.");
    }
    const path = pathname.slice(1);

    const state = await selectProvider();
    if (!state) return sendNotConnected(request, response, path === "");

    // Pages always send their generation on writes; refuse anything pinned to a different provider run.
    const pinned = request.headers[HEADERS.generation];
    const stale = PINNED_WRITES.has(path)
      ? pinned !== state.generation
      : pinned !== undefined && pinned !== state.generation;
    if (stale) {
      return sendError(
        request,
        response,
        ERROR_CODES.staleProvider,
        "Out of date. Reload to reconnect.",
      );
    }

    let body: Buffer | undefined;
    if (PINNED_WRITES.has(path)) {
      const read = await readBody(request, LIMITS.maxBodyBytes);
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
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/**
 * Renders `text` as a terminal QR code: two modules per character cell using half blocks, with a
 * 4-module quiet zone. Explicit black-on-white colors keep it scannable on light and dark themes.
 */
export function renderTerminalQr(text: string, color = !process.env.NO_COLOR): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const quiet = 4;
  const size = qr.getModuleCount() + quiet * 2;
  const dark = (row: number, col: number) => {
    const r = row - quiet;
    const c = col - quiet;
    return r >= 0 && c >= 0 && r < size - quiet * 2 && c < size - quiet * 2 && qr.isDark(r, c);
  };
  const [start, end] = color ? ["\x1b[38;5;16;48;5;231m", "\x1b[0m"] : ["", ""];
  const lines: string[] = [];
  for (let row = 0; row < size; row += 2) {
    let line = "";
    for (let col = 0; col < size; col++) {
      const top = dark(row, col);
      const bottom = dark(row + 1, col);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(start + line + end);
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = loadConfig(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const gateway = createGateway({
    port: config.gatewayPort,
    allowedOrigin: config.gatewayAllowedOrigin,
    statePath: process.env.GATEWAY_STATE_FILE || undefined,
    sessionsDir: sessionsDir(config),
  });
  const { port } = await gateway.listen();
  console.log(`gateway listening on 127.0.0.1:${port}`);

  // Publish only the public root origin so the canvas can offer "Open on phone".
  const sharePath = gatewayStatePath(config);
  const share = config.gatewayAllowedOrigin ? buildGatewayState(config.gatewayAllowedOrigin) : null;
  if (share) {
    writePrivateJson(sharePath, share);
    console.log(`\nOpen on phone: ${share.publicUrl}\n\n${renderTerminalQr(share.publicUrl)}\n`);
    console.log("Use an owner-only tunnel and a browser signed in as the tunnel owner.");
  } else {
    console.log("Set GATEWAY_ALLOWED_ORIGIN to your tunnel origin to enable Open on phone.");
  }
  const removeShare = () => {
    if (share && readGatewayState(sharePath)?.pid === process.pid)
      rmSync(sharePath, { force: true });
  };
  process.on("exit", removeShare);
  const shutdown = () => void gateway.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
