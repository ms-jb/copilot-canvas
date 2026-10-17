// Template configuration: template.config.json plus environment overrides. Node only.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_CONFIG = Object.freeze({
    extensionName: "canvas-chat-starter",
    canvasId: "chat-panel",
    displayName: "Chat Panel",
    description: "A connected chat panel for this session's own conversation.",
    defaultView: "chat",
    gatewayPort: 47600,
    gatewayAllowedOrigin: "",
});
function parsePort(value, fallback) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : fallback;
}
function normalizeOrigin(value) {
    if (typeof value !== "string" || value.trim() === "")
        return "";
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:")
            return "";
        return url.origin;
    }
    catch {
        return "";
    }
}
/**
 * Merges raw JSON config with env overrides and validates the result.
 * Env: EXTENSION_NAME, CANVAS_ID, CANVAS_DISPLAY_NAME, GATEWAY_PORT, GATEWAY_ALLOWED_ORIGIN.
 */
export function resolveConfig(raw = {}, env = process.env) {
    const overrides = raw && typeof raw === "object" ? raw : {};
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
        displayName: String(env.CANVAS_DISPLAY_NAME || merged.displayName),
        description: String(merged.description),
        defaultView: String(merged.defaultView || "chat"),
        gatewayPort: parsePort(env.GATEWAY_PORT ?? merged.gatewayPort, DEFAULT_CONFIG.gatewayPort),
        gatewayAllowedOrigin: normalizeOrigin(env.GATEWAY_ALLOWED_ORIGIN ?? merged.gatewayAllowedOrigin),
    };
}
/** Reads `<dir>/template.config.json` (missing file => defaults) and applies env overrides. */
export function loadConfig(dir, env = process.env) {
    let raw = {};
    try {
        raw = JSON.parse(readFileSync(join(dir, "template.config.json"), "utf8"));
    }
    catch (error) {
        if (error?.code !== "ENOENT")
            throw error;
    }
    return resolveConfig(raw, env);
}
export function copilotHome(env = process.env) {
    return env.COPILOT_HOME || join(homedir(), ".copilot");
}
/** Directory where the provider publishes its private runtime state (outside any repo). */
export function runtimeDir(config, env = process.env) {
    return env.CANVAS_RUNTIME_DIR || join(copilotHome(env), "canvas-runtime", config.extensionName);
}
export function providerStatePath(config, env = process.env) {
    return join(runtimeDir(config, env), "provider.json");
}
