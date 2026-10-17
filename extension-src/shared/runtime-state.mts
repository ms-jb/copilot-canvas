// Private runtime state files the provider publishes for the gateway, one per Copilot session.
// Each holds the provider's loopback address and capability path: keep them owner-only, never log them.

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CONTRACT_VERSION, IDENTITY_APP, isPlainObject, toPublicOrigin } from "./contract.mts";

export interface ProviderState {
  app: string;
  contractVersion: number;
  generation: string;
  origin: string;
  capabilityPath: string;
  pid: number;
  sessionId: string;
  startedAt: string;
  /** Last time a canvas was opened or focused in this session; the gateway follows the newest. */
  openedAt: string;
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
  const startedAt = typeof value.startedAt === "string" ? value.startedAt : "";
  return {
    app: value.app,
    contractVersion: value.contractVersion,
    generation: value.generation,
    origin: value.origin,
    capabilityPath: value.capabilityPath,
    pid: value.pid,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : "",
    startedAt,
    openedAt: typeof value.openedAt === "string" ? value.openedAt : startedAt,
  };
}

export function buildProviderState(input: {
  generation: string;
  origin: string;
  capabilityPath: string;
  sessionId?: string;
  pid?: number;
  openedAt?: string;
}): ProviderState {
  const now = new Date().toISOString();
  return {
    app: IDENTITY_APP,
    contractVersion: CONTRACT_VERSION,
    generation: input.generation,
    origin: input.origin,
    capabilityPath: input.capabilityPath,
    pid: input.pid ?? process.pid,
    sessionId: input.sessionId ?? "",
    startedAt: now,
    openedAt: input.openedAt ?? now,
  };
}

/** True when `pid` is a running process (EPERM means it exists but belongs to someone else). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

/**
 * Valid provider states in `dir` whose process is still running, most recently opened first.
 * Malformed files and files left behind by dead processes are skipped.
 */
export function readLiveProviders(dir: string): ProviderState[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const states: ProviderState[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const state = readProviderState(join(dir, name));
    if (state && isProcessAlive(state.pid)) states.push(state);
  }
  return states.sort(
    (a, b) =>
      b.openedAt.localeCompare(a.openedAt) ||
      b.startedAt.localeCompare(a.startedAt) ||
      a.generation.localeCompare(b.generation),
  );
}
/** Gateway state: only the public origin (never a path or token) and the owning pid. */
export interface GatewayState {
  app: string;
  publicUrl: string;
  pid: number;
}

export function buildGatewayState(
  publicUrl: string,
  pid: number = process.pid,
): GatewayState | null {
  const origin = toPublicOrigin(publicUrl);
  return origin ? { app: IDENTITY_APP, publicUrl: origin, pid } : null;
}

export function readGatewayState(path: string): GatewayState | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(value) || value.app !== IDENTITY_APP || typeof value.pid !== "number") {
      return null;
    }
    const origin = toPublicOrigin(value.publicUrl);
    return origin ? { app: IDENTITY_APP, publicUrl: origin, pid: value.pid } : null;
  } catch {
    return null;
  }
}

/** Atomically writes a private state file with owner-only permissions where supported. */
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  try {
    chmodSync(temporary, 0o600);
  } catch {
    // Not supported on every platform/filesystem.
  }
  renameSync(temporary, path);
}

/** Atomically writes the state file with owner-only permissions where supported. */
export function writeProviderState(path: string, state: ProviderState): void {
  writePrivateJson(path, state);
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
