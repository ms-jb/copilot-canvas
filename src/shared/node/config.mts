// Template configuration: template.config.json plus environment overrides. Node only.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface TemplateConfig {
  extensionName: string;
  canvasId: string;
  assistantName: string;
  description: string;
  defaultView: string;
  gatewayPort: number;
  gatewayAllowedOrigin: string;
}

export type Env = Record<string, string | undefined>;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const DEFAULT_CONFIG: Readonly<TemplateConfig> = Object.freeze({
  extensionName: "copilot-companion",
  canvasId: "chat-panel",
  assistantName: "Copilot",
  description: "Your Copilot conversation in a focused, phone-ready canvas.",
  defaultView: "chat",
  gatewayPort: 47600,
  gatewayAllowedOrigin: "",
});

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}

function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * Merges raw JSON config with env overrides and validates the result.
 * Env: EXTENSION_NAME, CANVAS_ID, ASSISTANT_NAME, GATEWAY_PORT, GATEWAY_ALLOWED_ORIGIN.
 */
export function resolveConfig(raw: unknown = {}, env: Env = process.env): TemplateConfig {
  const overrides = raw && typeof raw === "object" ? (raw as Partial<TemplateConfig>) : {};
  const merged = { ...DEFAULT_CONFIG, ...overrides };
  const extensionName = env.EXTENSION_NAME || merged.extensionName;
  const canvasId = env.CANVAS_ID || merged.canvasId;
  if (!NAME_PATTERN.test(String(extensionName))) {
    throw new Error("extensionName must be 1-64 characters: letters, digits, '.', '_' or '-'.");
  }
  if (!CANVAS_ID_PATTERN.test(String(canvasId))) {
    throw new Error("canvasId must be lowercase letters, digits or '-'.");
  }
  return {
    extensionName: String(extensionName),
    canvasId: String(canvasId),
    assistantName: String(env.ASSISTANT_NAME || merged.assistantName),
    description: String(merged.description),
    defaultView: String(merged.defaultView || "chat"),
    gatewayPort: parsePort(env.GATEWAY_PORT ?? merged.gatewayPort, DEFAULT_CONFIG.gatewayPort),
    gatewayAllowedOrigin: normalizeOrigin(
      env.GATEWAY_ALLOWED_ORIGIN ?? merged.gatewayAllowedOrigin,
    ),
  };
}

/** Written next to an installed copy so it can find the clone it came from. */
export const INSTALL_MARKER = ".installed-by-template.json";

/**
 * The clone `npm run install-ext` installed `dir` from, or "". Read on demand: setup installs
 * over a running copy, and a hint is all it is (the clone can move).
 */
export function readSourceDir(dir: string): string {
  try {
    const { sourceDir } = JSON.parse(readFileSync(join(dir, INSTALL_MARKER), "utf8")) as {
      sourceDir?: unknown;
    };
    return typeof sourceDir === "string" && isAbsolute(sourceDir) ? sourceDir : "";
  } catch {
    return "";
  }
}

/** Reads `<dir>/template.config.json` (missing file => defaults) and applies env overrides. */
export function loadConfig(dir: string, env: Env = process.env): TemplateConfig {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(join(dir, "template.config.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  return resolveConfig(raw, env);
}

export function copilotHome(env: Env = process.env): string {
  return env.COPILOT_HOME || join(homedir(), ".copilot");
}

/** Directory where the provider publishes its private runtime state (outside any repo). */
export function runtimeDir(config: TemplateConfig, env: Env = process.env): string {
  return env.CANVAS_RUNTIME_DIR || join(copilotHome(env), "canvas-runtime", config.extensionName);
}

/** One provider state file per Copilot session lives here, so concurrent sessions never collide. */
export function sessionsDir(config: TemplateConfig, env: Env = process.env): string {
  return join(runtimeDir(config, env), "sessions");
}

const SAFE_SESSION_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/**
 * File-name-safe form of a session id: kept as is when already safe, otherwise a sanitized,
 * bounded prefix plus a short hash so distinct ids never share a file.
 */
export function safeSessionFileName(sessionId: string): string {
  if (SAFE_SESSION_NAME.test(sessionId)) return sessionId;
  const prefix = sessionId
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 64);
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return prefix ? `${prefix}-${hash}` : `session-${hash}`;
}

export function providerStatePathFor(
  config: TemplateConfig,
  sessionId: string,
  env: Env = process.env,
): string {
  return join(sessionsDir(config, env), `${safeSessionFileName(sessionId)}.json`);
}

/** Written by the gateway while it runs: lets the extension learn the public origin for "Open on phone". */
export function gatewayStatePath(config: TemplateConfig, env: Env = process.env): string {
  return join(runtimeDir(config, env), "gateway.json");
}

/** Secret that lets local tools push a notice through the gateway (`npm run notify`). */
export function notifyTokenPath(config: TemplateConfig, env: Env = process.env): string {
  return join(runtimeDir(config, env), "notify-token");
}
