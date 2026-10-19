// Loopback listener lifecycle and HTTP composition. No route bypasses request-policy.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { ERROR_CODES, LIMITS } from "../../shared/contract.mjs";
import { loopbackOrigin } from "../../shared/node/security.mjs";
import { createAssetHandler } from "./assets.mjs";
import { createEventStream } from "./event-stream.mjs";
import { createRequestPolicy } from "./request-policy.mjs";
import { createRoutes } from "./routes.mjs";
import { errorMessage, sendError } from "./responses.mjs";
/** Creates a provider; `start()` listens on 127.0.0.1 with an OS-assigned port by default. */
export function createProviderServer({ config, bridge, uiDir, log = () => { }, getShareInfo = () => ({ publicUrl: null }), getSourceDir = () => "", getSessions = async () => ({
    sessionId: bridge.sessionId,
    source: "unavailable",
    checkedAt: new Date().toISOString(),
    sessions: [],
}), port: requestedPort = 0, generation = randomBytes(16).toString("base64url"), csrfToken = randomBytes(32).toString("base64url"), token = randomBytes(32).toString("base64url"), keepaliveMs = LIMITS.keepaliveMs, frameAncestors = "", }) {
    const capabilityPath = `/${config.canvasId}/${token}/`;
    let listenPort = 0;
    let startPromise = null;
    let closePromise = null;
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
            .catch((error) => {
            log(`Request failed: ${errorMessage(error)}`, "warning");
            if (!res.headersSent)
                sendError(res, ERROR_CODES.internal, "Internal error.");
            else
                res.destroy();
        });
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.on("clientError", (_error, socket) => {
        if (socket.writable)
            socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
    const api = {
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
                startPromise = new Promise((resolveStart, rejectStart) => {
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
                closePromise = new Promise((resolveClose) => {
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
