// Private runtime state file the provider publishes for the gateway. Node only.
// Contains the provider's loopback address and capability path: keep it owner-only, never log it.

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONTRACT_VERSION, IDENTITY_APP, isPlainObject } from "./contract.mts";

export interface ProviderState {
  app: string;
  contractVersion: number;
  generation: string;
  origin: string;
  capabilityPath: string;
  pid: number;
  startedAt: string;
}

const ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const CAPABILITY_PATH_PATTERN = /^\/[A-Za-z0-9_-]{8,128}\/[A-Za-z0-9_-]{32,128}\/$/;

/** Returns the parsed state if it is well-formed and loopback-only, otherwise null. */
export function parseProviderState(value: unknown): ProviderState | null {
  if (!isPlainObject(value)) return null;
  if (value.app !== IDENTITY_APP || value.contractVersion !== CONTRACT_VERSION) return null;
  if (typeof value.generation !== "string" || value.generation.length < 8) return null;
  if (typeof value.origin !== "string" || !ORIGIN_PATTERN.test(value.origin)) return null;
  if (
    typeof value.capabilityPath !== "string" ||
    !CAPABILITY_PATH_PATTERN.test(value.capabilityPath)
  ) {
    return null;
  }
  if (typeof value.pid !== "number" || !Number.isInteger(value.pid)) return null;
  return {
    app: value.app,
    contractVersion: value.contractVersion,
    generation: value.generation,
    origin: value.origin,
    capabilityPath: value.capabilityPath,
    pid: value.pid,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
  };
}

export function buildProviderState(input: {
  generation: string;
  origin: string;
  capabilityPath: string;
  pid?: number;
}): ProviderState {
  return {
    app: IDENTITY_APP,
    contractVersion: CONTRACT_VERSION,
    generation: input.generation,
    origin: input.origin,
    capabilityPath: input.capabilityPath,
    pid: input.pid ?? process.pid,
    startedAt: new Date().toISOString(),
  };
}

/** Atomically writes the state file with owner-only permissions where supported. */
export function writeProviderState(path: string, state: ProviderState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
  } catch {
    // Not supported on every platform/filesystem.
  }
  renameSync(temporary, path);
}

/** Reads and validates the state file. Returns null when absent or invalid. */
export function readProviderState(path: string): ProviderState | null {
  try {
    return parseProviderState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/** Removes the state file only if it still belongs to `generation`. */
export function removeProviderState(path: string, generation: string): boolean {
  const current = readProviderState(path);
  if (current && current.generation === generation) {
    rmSync(path, { force: true });
    return true;
  }
  return false;
}
