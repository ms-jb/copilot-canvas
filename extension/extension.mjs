// Extension entry point. The only file that imports the Copilot SDK.
// Joins the current session once; that session is the only transcript source and composer target.
// Each Copilot chat session that loads this extension runs its own copy, so the canvas always
// shows the session it was opened from.
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadConfig, resolveConfig } from "./shared/config.mjs";
import { createSessionBridge } from "./lib/bridge.mjs";
import { createChatCanvas } from "./lib/canvas.mjs";
import { startProvider } from "./lib/provider.mjs";
const extensionDir = dirname(fileURLToPath(import.meta.url));
const uiDir = join(extensionDir, "ui");
let session = null;
const earlyLogs = [];
// stdout is the JSON-RPC channel, so everything goes through the session logger.
function log(message, level = "info") {
    if (!session) {
        earlyLogs.push([message, level]);
        return;
    }
    session.log(message, { level, ephemeral: level === "info" }).catch(() => { });
}
let config;
try {
    config = loadConfig(extensionDir);
}
catch (error) {
    log(`Invalid template.config.json, using defaults: ${error instanceof Error ? error.message : "error"}`, "warning");
    config = resolveConfig(DEFAULT_CONFIG, {});
}
let bridge = null;
let resolveBridge = () => { };
const bridgeReady = new Promise((resolve) => {
    resolveBridge = resolve;
});
const chat = createChatCanvas({
    config,
    createCanvas,
    log,
    getStatus: () => bridge?.getSnapshot().snapshot.status ?? null,
    getSessionId: async () => {
        await bridgeReady;
        return session?.sessionId ?? null;
    },
    createError: (code, message) => new CanvasError(code, message),
    ensureProvider: async () => {
        const ready = await bridgeReady;
        return startProvider({
            config,
            bridge: ready,
            sessionId: session?.sessionId ?? "",
            uiDir,
            log,
        });
    },
});
const joined = await joinSession({
    streaming: true,
    canvases: [chat.canvas],
});
session = joined;
for (const [message, level] of earlyLogs.splice(0))
    log(message, level);
bridge = createSessionBridge(joined, { log });
await Promise.race([
    bridge.ready,
    new Promise((resolve) => setTimeout(resolve, 10000).unref()),
]);
resolveBridge(bridge);
let shutdownPromise = null;
function shutdown(reason) {
    shutdownPromise ??= (async () => {
        bridge?.dispose();
        await chat.shutdown().catch(() => { });
        log(`${config.assistantName} canvas stopped (${reason}).`);
    })();
    return shutdownPromise;
}
joined.on("session.shutdown", () => {
    void shutdown("session shutdown");
});
process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
});
