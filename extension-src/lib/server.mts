// Loopback HTTP provider: serves the built renderer and the JSON/SSE API for one session bridge.
//
// Every request is checked for an exact loopback Host and an allowed Origin, and must live under
// the unguessable capability prefix `/<canvasId>/<token>/`. Nothing here sets CORS headers.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import {
  API,
  CONTRACT_VERSION,
  ERROR_CODES,
  HEADERS,
  HTTP_STATUS_BY_CODE,
  IDENTITY_APP,
  LIMITS,
  SEND_STATUS,
  SSE_EVENTS,
  toPublicOrigin,
  validateControlsPayload,
  validateReloadPayload,
  validateRespondPayload,
  validateSendPayload,
} from "../shared/contract.mts";
import type { Bootstrap, Identity, RespondResult, ShareInfo } from "../shared/contract.mts";
import type { TemplateConfig } from "../shared/config.mts";
import {
  SENSITIVE_RESPONSE_HEADERS,
  checkOrigin,
  isAllowedHost,
  isJsonContentType,
  loopbackHost,
  loopbackOrigin,
  timingSafeEqualStrings,
} from "../shared/security.mts";
import type { Bridge, Logger, SendOutcome } from "./bridge.mts";
import { ControlError } from "./controls.mts";
import type { RespondOutcome } from "./prompts.mts";

const MAX_TRACKED_SENDS = 500;
const MAX_SSE_CLIENTS = 16;
const MAX_SSE_BUFFERED_BYTES = 2 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
});

export interface ProviderServerOptions {
  config: Pick<TemplateConfig, "canvasId" | "assistantName" | "description" | "defaultView">;
  bridge: Bridge;
  /** Public root origin for "Open on phone" (read on each request). Defaults to none. */
  getShareInfo?: () => ShareInfo;
  /** The user's source clone for suggested prompts, read on each bootstrap; "" when unknown. */
  getSourceDir?: () => string;
  /** Directory holding the built renderer (index.html + assets/). Missing => placeholder page. */
  uiDir?: string;
  log?: Logger;
  /** Test hooks. */
  port?: number;
  generation?: string;
  csrfToken?: string;
  token?: string;
  keepaliveMs?: number;
  /**
   * Value for the CSP frame-ancestors directive. Empty (default) omits it because the Copilot app
   * embeds canvases from another origin.
   */
  frameAncestors?: string;
}

export interface ProviderServer {
  readonly capabilityPath: string;
  readonly generation: string;
  readonly csrfToken: string;
  readonly port: number;
  readonly origin: string;
  readonly url: string;
  start(): Promise<ProviderServer>;
  close(): Promise<void>;
}

interface SseClient {
  res: ServerResponse;
  closed: boolean;
  keepalive: ReturnType<typeof setInterval> | null;
  unsubscribe: () => void;
}

type BodyResult = { body: string } | { tooLarge: true } | { failed: true };

function buildCsp(frameAncestors: string): string {
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (frameAncestors) directives.push(`frame-ancestors ${frameAncestors}`);
  return directives.join("; ");
}

function fallbackPage(assistantName: string): string {
  const title = assistantName.replace(/[<>&"']/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:2rem;color:CanvasText;background:Canvas}code{font-family:ui-monospace,monospace}</style></head><body><h1>UI not built</h1><p>The renderer has not been built yet. Run <code>npx vp build</code> in the template repository, then reload extensions and reopen this canvas.</p></body></html>`;
}

function isRead(method: string | undefined): boolean {
  return method === "GET" || method === "HEAD";
}

function statusFor(code: string): number {
  return HTTP_STATUS_BY_CODE[code] ?? 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

/**
 * Creates the provider server around a bridge (see `Bridge` in bridge.mts).
 * Call `start()` to listen on 127.0.0.1 (OS-assigned port unless `port` is set).
 */
export function createProviderServer({
  config,
  bridge,
  uiDir,
  log = () => {},
  getShareInfo = () => ({ publicUrl: null }),
  getSourceDir = () => "",
  port: requestedPort = 0,
  generation = randomBytes(16).toString("base64url"),
  csrfToken = randomBytes(32).toString("base64url"),
  token = randomBytes(32).toString("base64url"),
  keepaliveMs = LIMITS.keepaliveMs,
  frameAncestors = "",
}: ProviderServerOptions): ProviderServer {
  const capabilityPath = `/${config.canvasId}/${token}/`;
  const uiRoot = uiDir ? resolve(uiDir) : null;
  const csp = buildCsp(frameAncestors);
  const sendOutcomes = new Map<string, { outcome: SendOutcome | null }>();
  const sseClients = new Set<SseClient>();
  let listenPort = 0;
  let startPromise: Promise<ProviderServer> | null = null;
  let closePromise: Promise<void> | null = null;

  function baseHeaders(contentType?: string): OutgoingHttpHeaders {
    return {
      ...SENSITIVE_RESPONSE_HEADERS,
      ...(contentType ? { "content-type": contentType } : {}),
    };
  }

  function sendJson(
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

  function sendError(
    res: ServerResponse,
    code: string,
    message: string,
    status: string = "error",
    extra?: OutgoingHttpHeaders,
  ): void {
    sendJson(res, statusFor(code), { ok: false, status, code, message }, extra);
  }

  function sendRejected(
    res: ServerResponse,
    code: string,
    message: string,
    extra?: OutgoingHttpHeaders,
  ): void {
    sendError(res, code, message, SEND_STATUS.rejected, extra);
  }

  function notAllowed(res: ServerResponse, allow: string): void {
    sendError(res, ERROR_CODES.methodNotAllowed, "Method not allowed.", "error", { allow });
  }

  function staleGeneration(req: IncomingMessage): boolean {
    const header = req.headers[HEADERS.generation];
    return header !== undefined && !timingSafeEqualStrings(String(header), generation);
  }

  async function serveIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let html: Buffer | null = null;
    if (uiRoot) {
      try {
        html = await readFile(resolve(uiRoot, "index.html"));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "ENOENT" && code !== "EISDIR") {
          log(`Could not read index.html: ${code ?? "error"}`, "warning");
        }
      }
    }
    const body = html ?? Buffer.from(fallbackPage(config.assistantName));
    res.writeHead(200, {
      ...baseHeaders("text/html; charset=utf-8"),
      "content-security-policy": csp,
      "content-length": body.length,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  async function serveAsset(
    req: IncomingMessage,
    res: ServerResponse,
    relative: string,
  ): Promise<void> {
    const notFound = (): void => sendError(res, ERROR_CODES.notFound, "Not found.");
    if (!uiRoot) return notFound();
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return notFound();
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return notFound();
    const segments = decoded.split("/");
    if (segments.some((s) => s === "" || s.startsWith(".") || s.includes(":"))) return notFound();

    const target = resolve(uiRoot, ...segments);
    if (!target.startsWith(uiRoot + sep)) return notFound();
    try {
      const [realTarget, realRoot] = await Promise.all([realpath(target), realpath(uiRoot)]);
      if (!realTarget.startsWith(realRoot + sep)) return notFound();
      const info = await stat(realTarget);
      if (!info.isFile()) return notFound();
      res.writeHead(200, {
        ...baseHeaders(MIME_TYPES[extname(realTarget).toLowerCase()] ?? "application/octet-stream"),
        "content-length": info.size,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(realTarget);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) notFound();
    }
  }

  function handleBootstrap(res: ServerResponse): void {
    const { snapshot, controls } = bridge.getSnapshot();
    let sourceDir = "";
    try {
      sourceDir = getSourceDir();
    } catch {
      // Only a hint for suggested prompts.
    }
    const body: Bootstrap = {
      contractVersion: CONTRACT_VERSION,
      generation,
      sessionId: bridge.sessionId,
      csrfToken,
      config: {
        assistantName: config.assistantName,
        description: config.description,
        defaultView: config.defaultView,
        ...(sourceDir ? { sourceDir } : {}),
      },
      snapshot,
      controls,
    };
    sendJson(res, 200, body);
  }

  function handleShare(res: ServerResponse): void {
    let publicUrl: string | null = null;
    try {
      publicUrl = toPublicOrigin(getShareInfo().publicUrl);
    } catch (error) {
      log(`Could not read share info: ${errorMessage(error)}`, "warning");
    }
    const body: ShareInfo = { publicUrl };
    sendJson(res, 200, body);
  }

  function closeSse(client: SseClient): void {
    if (client.closed) return;
    client.closed = true;
    if (client.keepalive) clearInterval(client.keepalive);
    client.unsubscribe();
    sseClients.delete(client);
    try {
      client.res.end();
    } catch {
      // Socket already gone.
    }
  }

  function writeSse(client: SseClient, name: string, data: unknown): void {
    if (client.closed) return;
    const ok = client.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!ok && client.res.writableLength > MAX_SSE_BUFFERED_BYTES) closeSse(client);
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse): void {
    if (staleGeneration(req)) {
      sendError(res, ERROR_CODES.staleProvider, "The provider was restarted.");
      return;
    }
    res.writeHead(200, {
      ...baseHeaders("text/event-stream; charset=utf-8"),
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);

    const client: SseClient = { res, closed: false, keepalive: null, unsubscribe: () => {} };
    // Subscribe and snapshot in the same tick so no event is missed or duplicated.
    client.unsubscribe = bridge.subscribe((event) => {
      switch (event.type) {
        case "entry":
          writeSse(client, SSE_EVENTS.entry, { seq: event.seq, entry: event.entry });
          break;
        case "status":
          writeSse(client, SSE_EVENTS.status, { seq: event.seq, status: event.status });
          break;
        case "controls":
          writeSse(client, SSE_EVENTS.controls, { seq: event.seq, controls: event.controls });
          break;
        case "prompts":
          writeSse(client, SSE_EVENTS.prompts, { seq: event.seq, prompts: event.prompts });
          break;
      }
    });
    const { seq, snapshot, controls } = bridge.getSnapshot();
    writeSse(client, SSE_EVENTS.snapshot, { seq, generation, snapshot, controls });
    // A (re)connecting client may have missed requests answered elsewhere; re-check with the session.
    bridge.refreshPrompts();

    client.keepalive = setInterval(() => {
      if (!client.closed) res.write(": keepalive\n\n");
    }, keepaliveMs);
    client.keepalive.unref();

    sseClients.add(client);
    while (sseClients.size > MAX_SSE_CLIENTS) {
      const oldest = sseClients.values().next().value;
      if (!oldest) break;
      closeSse(oldest);
    }
    const onClose = (): void => closeSse(client);
    req.on("close", onClose);
    res.on("close", onClose);
    res.on("error", onClose);
  }

  function readBody(req: IncomingMessage, res: ServerResponse): Promise<BodyResult> {
    return new Promise((resolveBody) => {
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) {
        resolveBody({ tooLarge: true });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let done = false;
      const finish = (result: BodyResult): void => {
        if (done) return;
        done = true;
        req.off("data", onData);
        resolveBody(result);
      };
      const onData = (chunk: Buffer): void => {
        total += chunk.length;
        if (total > LIMITS.maxBodyBytes) {
          finish({ tooLarge: true });
          return;
        }
        chunks.push(chunk);
      };
      req.on("data", onData);
      req.on("end", () => finish({ body: Buffer.concat(chunks).toString("utf8") }));
      req.on("error", () => finish({ failed: true }));
      req.on("aborted", () => finish({ failed: true }));
      res.on("close", () => finish({ failed: true }));
    });
  }

  function rememberOutcome(requestId: string, record: { outcome: SendOutcome | null }): void {
    sendOutcomes.set(requestId, record);
    if (sendOutcomes.size > MAX_TRACKED_SENDS) {
      const oldest = sendOutcomes.keys().next().value;
      if (oldest !== undefined) sendOutcomes.delete(oldest);
    }
  }

  function respondWithOutcome(res: ServerResponse, outcome: SendOutcome): void {
    sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), outcome);
  }

  /**
   * Shared checks for state-changing POSTs: CSRF token, provider generation, JSON content type,
   * size limit and JSON parsing. Responds and returns `undefined` on any failure.
   */
  async function readJsonPost(
    req: IncomingMessage,
    res: ServerResponse,
    status: string,
  ): Promise<{ value: unknown } | undefined> {
    const fail = (code: string, message: string, extra?: OutgoingHttpHeaders): undefined => {
      sendError(res, code, message, status, extra);
      return undefined;
    };
    const providedCsrf = req.headers[HEADERS.csrf];
    if (typeof providedCsrf !== "string" || !timingSafeEqualStrings(providedCsrf, csrfToken)) {
      return fail(ERROR_CODES.forbidden, "Missing or invalid CSRF token.");
    }
    if (staleGeneration(req)) {
      return fail(ERROR_CODES.staleProvider, "The provider was restarted. Reload the page.");
    }
    if (!isJsonContentType(req.headers["content-type"])) {
      return fail(ERROR_CODES.unsupportedMediaType, "Content-Type must be application/json.");
    }
    const read = await readBody(req, res);
    if ("failed" in read) return undefined;
    if ("tooLarge" in read) {
      return fail(ERROR_CODES.payloadTooLarge, "Request body is too large.", {
        connection: "close",
      });
    }
    try {
      return { value: JSON.parse(read.body) as unknown };
    } catch {
      return fail(ERROR_CODES.badRequest, "Body is not valid JSON.");
    }
  }

  async function handleControls(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await readJsonPost(req, res, "error");
    if (!parsed) return;
    const validation = validateControlsPayload(parsed.value);
    if (!validation.ok) {
      sendError(res, validation.code, validation.message);
      return;
    }
    if (validation.value.sessionId !== bridge.sessionId) {
      sendError(res, ERROR_CODES.sessionMismatch, "This panel belongs to a different session.");
      return;
    }
    try {
      const controls = await bridge.applyControl(validation.value.change);
      sendJson(res, 200, { ok: true, controls });
    } catch (error) {
      if (error instanceof ControlError) {
        sendError(res, error.code, error.message);
        return;
      }
      log(`Control change failed: ${errorMessage(error)}`, "warning");
      sendError(res, ERROR_CODES.controlFailed, "The session did not apply the change.");
    }
  }

  async function handleReload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await readJsonPost(req, res, "error");
    if (!parsed) return;
    const validation = validateReloadPayload(parsed.value);
    if (!validation.ok) {
      sendError(res, validation.code, validation.message);
      return;
    }
    if (validation.value.sessionId !== bridge.sessionId) {
      sendError(res, ERROR_CODES.sessionMismatch, "This panel belongs to a different session.");
      return;
    }
    if (!bridge.reloadExtensions()) {
      sendError(
        res,
        ERROR_CODES.reloadUnavailable,
        "This Copilot version cannot reload extensions from the canvas.",
      );
      return;
    }
    sendJson(res, 200, { ok: true, status: "scheduled" });
  }

  async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await readJsonPost(req, res, SEND_STATUS.rejected);
    if (!parsed) return;
    const validation = validateSendPayload(parsed.value);
    if (!validation.ok) {
      sendRejected(res, validation.code, validation.message);
      return;
    }
    const { requestId, sessionId, text } = validation.value;
    if (sessionId !== bridge.sessionId) {
      sendRejected(res, ERROR_CODES.sessionMismatch, "This panel belongs to a different session.");
      return;
    }

    // Synchronous guard: the requestId is recorded before the first await below.
    const previous = sendOutcomes.get(requestId);
    if (previous) {
      if (previous.outcome) respondWithOutcome(res, previous.outcome);
      else sendRejected(res, ERROR_CODES.duplicateRequest, "This request is already being sent.");
      return;
    }
    const record: { outcome: SendOutcome | null } = { outcome: null };
    rememberOutcome(requestId, record);

    let outcome: SendOutcome;
    try {
      outcome = await bridge.send(text, requestId);
    } catch (error) {
      log(`Send failed: ${errorMessage(error)}`, "warning");
      outcome = {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.sendFailed,
        message: "The session did not accept the message.",
        requestId,
      };
    }
    record.outcome = outcome;
    respondWithOutcome(res, outcome);
  }

  async function handleRespond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await readJsonPost(req, res, SEND_STATUS.rejected);
    if (!parsed) return;
    const validation = validateRespondPayload(parsed.value);
    if (!validation.ok) {
      sendRejected(res, validation.code, validation.message);
      return;
    }
    const { sessionId, requestId, response } = validation.value;
    if (sessionId !== bridge.sessionId) {
      sendRejected(res, ERROR_CODES.sessionMismatch, "This panel belongs to a different session.");
      return;
    }
    let outcome: RespondOutcome;
    try {
      outcome = await bridge.respond(requestId, response);
    } catch (error) {
      log(`Answer failed: ${errorMessage(error)}`, "warning");
      outcome = {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.respondFailed,
        message: "The session didn't accept the answer.",
      };
    }
    const body: RespondResult = outcome;
    sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), body);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedHost(req.headers.host, [loopbackHost(listenPort)])) {
      sendError(res, ERROR_CODES.forbidden, "Forbidden.");
      return;
    }
    const allowedOrigins = [loopbackOrigin(listenPort)];
    if (!checkOrigin({ method: req.method ?? "", headers: req.headers, allowedOrigins })) {
      sendError(res, ERROR_CODES.forbidden, "Forbidden.");
      return;
    }

    const rawUrl = req.url ?? "";
    const queryIndex = rawUrl.indexOf("?");
    const pathname = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
    if (isRead(req.method) && timingSafeEqualStrings(pathname + "/", capabilityPath)) {
      res.writeHead(308, { location: capabilityPath, ...baseHeaders() });
      res.end();
      return;
    }
    const prefix = pathname.slice(0, capabilityPath.length);
    if (!timingSafeEqualStrings(prefix, capabilityPath)) {
      sendError(res, ERROR_CODES.notFound, "Not found.");
      return;
    }
    const relative = pathname.slice(capabilityPath.length);
    const method = req.method;

    if (relative === "" || relative === "index.html") {
      if (!isRead(method)) return notAllowed(res, "GET, HEAD");
      return serveIndex(req, res);
    }
    if (relative.startsWith("assets/")) {
      if (!isRead(method)) return notAllowed(res, "GET, HEAD");
      return serveAsset(req, res, relative);
    }
    switch (relative) {
      case API.identity: {
        if (method !== "GET") return notAllowed(res, "GET");
        const identity: Identity = {
          app: IDENTITY_APP,
          contractVersion: CONTRACT_VERSION,
          generation,
        };
        return sendJson(res, 200, identity);
      }
      case API.bootstrap:
        if (method !== "GET") return notAllowed(res, "GET");
        return handleBootstrap(res);
      case API.events:
        if (method !== "GET") return notAllowed(res, "GET");
        return handleEvents(req, res);
      case API.send:
        if (method !== "POST") return notAllowed(res, "POST");
        return handleSend(req, res);
      case API.controls:
        if (method !== "POST") return notAllowed(res, "POST");
        return handleControls(req, res);
      case API.respond:
        if (method !== "POST") return notAllowed(res, "POST");
        return handleRespond(req, res);
      case API.reload:
        if (method !== "POST") return notAllowed(res, "POST");
        return handleReload(req, res);
      case API.share:
        if (method !== "GET") return notAllowed(res, "GET");
        return handleShare(res);
      default:
        return sendError(res, ERROR_CODES.notFound, "Not found.");
    }
  }

  const server: Server = createServer((req, res) => {
    Promise.resolve()
      .then(() => route(req, res))
      .catch((error: unknown) => {
        log(`Request failed: ${errorMessage(error)}`, "warning");
        if (!res.headersSent) sendError(res, ERROR_CODES.internal, "Internal error.");
        else res.destroy();
      });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  const api: ProviderServer = {
    capabilityPath,
    generation,
    csrfToken,
    get port() {
      return listenPort;
    },
    get origin() {
      return listenPort ? loopbackOrigin(listenPort) : "";
    },
    get url() {
      return listenPort ? loopbackOrigin(listenPort) + capabilityPath : "";
    },
    start() {
      if (!startPromise) {
        startPromise = new Promise<ProviderServer>((resolveStart, rejectStart) => {
          server.once("error", rejectStart);
          server.listen(requestedPort, "127.0.0.1", () => {
            server.off("error", rejectStart);
            const address = server.address();
            listenPort = typeof address === "object" && address ? address.port : 0;
            resolveStart(api);
          });
        });
      }
      return startPromise;
    },
    close() {
      if (!closePromise) {
        closePromise = new Promise<void>((resolveClose) => {
          for (const client of Array.from(sseClients)) closeSse(client);
          if (!server.listening) {
            resolveClose();
            return;
          }
          server.close(() => resolveClose());
          server.closeAllConnections();
        });
      }
      return closePromise;
    },
  };
  return api;
}
