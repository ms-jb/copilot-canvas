import http from "node:http";
import { API, validateIdentity } from "../../src/shared/contract.mts";
import { readLiveProviders, readProviderState } from "../../src/shared/node/runtime-state.mts";
import type { ProviderState } from "../../src/shared/node/runtime-state.mts";
import { LOOPBACK } from "./request-policy.mts";

// Provider selection (file scan + identity probe) is reused for this long.
const SELECTION_TTL_MS = 500;

export type SelectProvider = () => Promise<ProviderState | null>;

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

export function createProviderSelector(options: {
  statePath?: string;
  sessionsDir?: string;
}): SelectProvider {
  const { statePath, sessionsDir: stateDir } = options;
  function candidates(): ProviderState[] {
    if (statePath) {
      const state = readProviderState(statePath);
      return state ? [state] : [];
    }
    return stateDir ? readLiveProviders(stateDir) : [];
  }

  let selection: { at: number; result: Promise<ProviderState | null> } | null = null;
  // The most recently opened provider that answers its identity probe with its own generation.
  return () => {
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
  };
}
