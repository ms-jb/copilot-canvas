// Provider state: publishes and retracts the private runtime state file read by the gateway.
// The file holds the loopback origin and capability path: never log its contents.

import { providerStatePath } from "../shared/config.mts";
import type { Env, TemplateConfig } from "../shared/config.mts";
import {
  buildProviderState,
  removeProviderState,
  writeProviderState,
} from "../shared/runtime-state.mts";
import type { Logger } from "./bridge.mts";

export interface PublishedProviderState {
  path: string;
  /** Deletes the file only if it still belongs to this generation. */
  remove(): boolean;
}

/**
 * Writes the state file for a listening provider. Failures are logged, never thrown: the
 * canvas works without the file; only the optional gateway needs it.
 */
export function publishProviderState(input: {
  config: TemplateConfig;
  generation: string;
  origin: string;
  capabilityPath: string;
  env?: Env;
  log?: Logger;
}): PublishedProviderState {
  const { config, generation, origin, capabilityPath, env = process.env, log = () => {} } = input;
  const path = providerStatePath(config, env);
  let published = false;
  try {
    writeProviderState(path, buildProviderState({ generation, origin, capabilityPath }));
    published = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    log(`Could not publish provider state: ${code ?? "error"}`, "warning");
  }
  return {
    path,
    remove() {
      if (!published) return false;
      published = false;
      try {
        return removeProviderState(path, generation);
      } catch {
        return false;
      }
    },
  };
}
