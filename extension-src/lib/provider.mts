// Starts one provider (HTTP server + private runtime state file) for a session bridge.
// Each Copilot session runs its own extension process and publishes its own state file, keyed by
// session id. The file holds the loopback origin and capability path for the optional gateway:
// never log its contents.

import { dirname } from "node:path";
import { gatewayStatePath, providerStatePathFor, readSourceDir } from "../shared/config.mts";
import type { Env, TemplateConfig } from "../shared/config.mts";
import { toPublicOrigin } from "../shared/contract.mts";
import type { ShareInfo } from "../shared/contract.mts";
import {
  buildProviderState,
  isProcessAlive,
  readGatewayState,
  readProviderState,
  removeProviderState,
  writeProviderState,
} from "../shared/runtime-state.mts";
import type { ProviderState } from "../shared/runtime-state.mts";
import type { Bridge, Logger } from "./bridge.mts";
import { createProviderServer } from "./server.mts";
import type { ProviderServer, ProviderServerOptions } from "./server.mts";

export interface RunningProvider {
  url: string;
  generation: string;
  server: ProviderServer;
  /** Records that a canvas was just opened or focused, so the gateway follows this session. */
  markOpened(): void;
  close(): Promise<void>;
}

/**
 * Public root origin for "Open on phone": the running gateway's published origin, else the
 * configured allowed origin. Origin only; never a path or token.
 */
export function readShareInfo(config: TemplateConfig, env: Env = process.env): ShareInfo {
  const gateway = readGatewayState(gatewayStatePath(config, env));
  const fromGateway = gateway && isProcessAlive(gateway.pid) ? gateway.publicUrl : null;
  return { publicUrl: toPublicOrigin(fromGateway) ?? toPublicOrigin(config.gatewayAllowedOrigin) };
}

interface PublishedState {
  markOpened(): void;
  remove(): void;
}

/**
 * Writes this session's state file for a listening provider. `markOpened()` refreshes its
 * `openedAt`; `remove()` deletes it only while it still belongs to this generation. Failures are
 * logged, never thrown: the canvas works without the file; only the optional gateway needs it.
 */
function publishProviderState(input: {
  config: TemplateConfig;
  server: ProviderServer;
  sessionId: string;
  env: Env;
  log: Logger;
}): PublishedState {
  const { config, server, sessionId, env, log } = input;
  const path = providerStatePathFor(config, sessionId, env);
  const state: ProviderState = buildProviderState({
    generation: server.generation,
    origin: server.origin,
    capabilityPath: server.capabilityPath,
    sessionId,
  });
  let removed = false;
  const write = (): boolean => {
    try {
      writeProviderState(path, state);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      log(`Could not publish provider state: ${code ?? "error"}`, "warning");
      return false;
    }
  };
  write();
  return {
    markOpened() {
      if (removed) return;
      const current = readProviderState(path);
      if (current && current.generation !== state.generation) return;
      state.openedAt = new Date().toISOString();
      write();
    },
    remove() {
      removed = true;
      try {
        removeProviderState(path, server.generation);
      } catch {
        // Already gone or unreadable.
      }
    },
  };
}

/** Resolves once the server is listening and its state file is published. */
export async function startProvider(input: {
  config: TemplateConfig;
  bridge: Bridge;
  sessionId: string;
  uiDir?: string;
  log?: Logger;
  env?: Env;
  serverOptions?: Partial<ProviderServerOptions>;
}): Promise<RunningProvider> {
  const {
    config,
    bridge,
    sessionId,
    uiDir,
    log = () => {},
    env = process.env,
    serverOptions = {},
  } = input;
  const server = createProviderServer({
    getShareInfo: () => readShareInfo(config, env),
    getSourceDir: () => (uiDir ? readSourceDir(dirname(uiDir)) : ""),
    ...serverOptions,
    config,
    bridge,
    uiDir,
    log,
  });
  await server.start();
  const published = publishProviderState({ config, server, sessionId, env, log });
  let closed = false;
  return {
    url: server.url,
    generation: server.generation,
    server,
    markOpened() {
      if (!closed) published.markOpened();
    },
    async close() {
      if (closed) return;
      closed = true;
      published.remove();
      await server.close();
    },
  };
}
