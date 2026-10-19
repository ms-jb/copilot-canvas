// Loopback listener lifecycle and HTTP composition. No route bypasses request-policy.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { ERROR_CODES, LIMITS } from "../../shared/contract.mts";
import type { ShareInfo } from "../../shared/contract.mts";
import type { SessionsInfo } from "../../shared/contract.mts";
import type { TemplateConfig } from "../../shared/node/config.mts";
import { loopbackOrigin } from "../../shared/node/security.mts";
import type { Bridge } from "../session/bridge.mts";
import type { Logger } from "../logging.mts";
import { createAssetHandler } from "./assets.mts";
import { createEventStream } from "./event-stream.mts";
import { createRequestPolicy } from "./request-policy.mts";
import { createRoutes } from "./routes.mts";
import { errorMessage, sendError } from "./responses.mts";

export interface ProviderServerOptions {
  config: Pick<TemplateConfig, "canvasId" | "assistantName" | "description" | "defaultView">;
  bridge: Bridge;
  /** Public root origin for "Open on phone" (read on each request). Defaults to none. */
  getShareInfo?: () => ShareInfo;
  getSessions?: () => Promise<SessionsInfo>;
  /** The user's source clone for suggested prompts, read on each bootstrap; "" when unknown. */
  getSourceDir?: () => string;
  /** Built renderer directory (index.html + assets/). Missing => placeholder page. */
  uiDir?: string;
  log?: Logger;
  /** Test hooks. */
  port?: number;
  generation?: string;
  csrfToken?: string;
  token?: string;
  keepaliveMs?: number;
  /** Empty omits frame-ancestors because the Copilot app embeds canvases from another origin. */
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

/** Creates a provider; `start()` listens on 127.0.0.1 with an OS-assigned port by default. */
export function createProviderServer({
  config,
  bridge,
  uiDir,
  log = () => {},
  getShareInfo = () => ({ publicUrl: null }),
  getSourceDir = () => "",
  getSessions = async () => ({
    sessionId: bridge.sessionId,
    source: "unavailable",
    checkedAt: new Date().toISOString(),
    sessions: [],
  }),
  port: requestedPort = 0,
  generation = randomBytes(16).toString("base64url"),
  csrfToken = randomBytes(32).toString("base64url"),
  token = randomBytes(32).toString("base64url"),
  keepaliveMs = LIMITS.keepaliveMs,
  frameAncestors = "",
}: ProviderServerOptions): ProviderServer {
  const capabilityPath = `/${config.canvasId}/${token}/`;
  let listenPort = 0;
  let startPromise: Promise<ProviderServer> | null = null;
  let closePromise: Promise<void> | null = null;
  const policy = createRequestPolicy({
    capabilityPath,
    generation,
    csrfToken,
    getPort: () => listenPort,
    getSessionId: () => bridge.sessionId,
  });
  const assets = createAssetHandler({
    uiDir,
    assistantName: config.assistantName,
    frameAncestors,
    log,
  });
  const events = createEventStream({ bridge, policy, generation, keepaliveMs });
  const route = createRoutes({
    config,
    bridge,
    generation,
    csrfToken,
    log,
    getSourceDir,
    getShareInfo,
    getSessions,
    policy,
    assets,
    events,
  });
  const server = createServer((req, res) => {
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
          events.close();
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
