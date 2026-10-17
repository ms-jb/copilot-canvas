// Starts one provider (HTTP server + runtime state file) for a session bridge.

import type { Env, TemplateConfig } from "../shared/config.mts";
import type { Bridge, Logger } from "./bridge.mts";
import { publishProviderState } from "./provider-state.mts";
import { createProviderServer } from "./server.mts";
import type { ProviderServer, ProviderServerOptions } from "./server.mts";

export interface RunningProvider {
  url: string;
  generation: string;
  server: ProviderServer;
  close(): Promise<void>;
}

/** Resolves once the server is listening and its state file is published. */
export async function startProvider(input: {
  config: TemplateConfig;
  bridge: Bridge;
  uiDir?: string;
  log?: Logger;
  env?: Env;
  serverOptions?: Partial<ProviderServerOptions>;
}): Promise<RunningProvider> {
  const { config, bridge, uiDir, log = () => {}, env = process.env, serverOptions = {} } = input;
  const server = createProviderServer({ ...serverOptions, config, bridge, uiDir, log });
  await server.start();
  const state = publishProviderState({
    config,
    generation: server.generation,
    origin: server.origin,
    capabilityPath: server.capabilityPath,
    env,
    log,
  });
  let closed = false;
  return {
    url: server.url,
    generation: server.generation,
    server,
    async close() {
      if (closed) return;
      closed = true;
      state.remove();
      await server.close();
    },
  };
}
