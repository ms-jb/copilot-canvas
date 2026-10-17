// Extension entry point. The only file that imports the Copilot SDK.
// Joins the current session once; that session is the only transcript source and composer target.
// Each Copilot chat session that loads this extension runs its own copy, so the canvas always
// shows the session it was opened from.

import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import type { CopilotSession } from "@github/copilot-sdk/extension";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadConfig, resolveConfig } from "./shared/node/config.mts";
import type { TemplateConfig } from "./shared/node/config.mts";
import { createSessionBridge } from "./host/bridge.mts";
import type { SessionBridge } from "./host/bridge.mts";
import type { LogLevel } from "./host/logging.mts";
import { createChatCanvas } from "./host/canvas.mts";
import { startProvider } from "./host/provider.mts";
import { createSessionsReader } from "./host/sessions/reader.mts";

// Structured canvas error exported by the SDK; declared here because the shared ambient typings omit it.
declare module "@github/copilot-sdk/extension" {
  export class CanvasError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
  }
}
const extensionDir = dirname(fileURLToPath(import.meta.url));
const uiDir = join(extensionDir, "ui");

let session: CopilotSession | null = null;
const earlyLogs: Array<[string, LogLevel]> = [];

// stdout is the JSON-RPC channel, so everything goes through the session logger.
function log(message: string, level: LogLevel = "info"): void {
  if (!session) {
    earlyLogs.push([message, level]);
    return;
  }
  session.log(message, { level, ephemeral: level === "info" }).catch(() => {});
}

let config: TemplateConfig;
try {
  config = loadConfig(extensionDir);
} catch (error) {
  log(
    `Invalid template.config.json, using defaults: ${error instanceof Error ? error.message : "error"}`,
    "warning",
  );
  config = resolveConfig(DEFAULT_CONFIG, {});
}

let bridge: SessionBridge | null = null;
let getSessions: ReturnType<typeof createSessionsReader> | undefined;
let resolveBridge: (value: SessionBridge) => void = () => {};
const bridgeReady = new Promise<SessionBridge>((resolve) => {
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
      serverOptions: { getSessions },
    });
  },
});

const joined = await joinSession({
  streaming: true,
  canvases: [chat.canvas],
});
session = joined;

for (const [message, level] of earlyLogs.splice(0)) log(message, level);

bridge = createSessionBridge(joined, { log });
getSessions = createSessionsReader({
  session: joined,
  sessionId: joined.sessionId,
  currentState: () => {
    const phase = bridge?.getSnapshot().snapshot.status.phase;
    return phase === "working"
      ? "busy"
      : phase === "waiting" || phase === "idle"
        ? phase
        : "unknown";
  },
});
await Promise.race([
  bridge.ready,
  new Promise<void>((resolve) => setTimeout(resolve, 10000).unref()),
]);
resolveBridge(bridge);

let shutdownPromise: Promise<void> | null = null;
function shutdown(reason: string): Promise<void> {
  shutdownPromise ??= (async () => {
    bridge?.dispose();
    await chat.shutdown().catch(() => {});
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
