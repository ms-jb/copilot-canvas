import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createSessionBridge } from "../extension-src/lib/bridge.mts";
import type { SessionLike } from "../extension-src/lib/bridge.mts";
import { INSTALL_MARKER, readSourceDir } from "../extension-src/shared/config.mts";
import { validateReloadPayload } from "../extension-src/shared/contract.mts";
import { isOwnerOnly, parseForwardingUrl } from "../scripts/phone.mts";
import { copyExtension, isOwnInstall } from "../scripts/install-ext.mts";

afterEach(() => {
  vi.useRealTimers();
});

function fakeSession(rpc?: SessionLike["rpc"]): SessionLike {
  return {
    sessionId: "session-1",
    on: () => () => {},
    getEvents: async () => [],
    send: async () => "message-1",
    rpc,
  };
}

it("validates reload payloads strictly", () => {
  expect(validateReloadPayload({ sessionId: "session-1" })).toEqual({
    ok: true,
    value: { sessionId: "session-1" },
  });
  for (const bad of [null, {}, { sessionId: "" }, { sessionId: "s", extra: true }]) {
    expect(validateReloadPayload(bad).ok).toBe(false);
  }
});

it("schedules one extension reload after replying, and reports when it cannot", async () => {
  vi.useFakeTimers();
  const reload = vi.fn(async () => {});
  const bridge = createSessionBridge(fakeSession({ extensions: { reload } }));
  expect(bridge.reloadExtensions()).toBe(true);
  expect(bridge.reloadExtensions()).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(reload).toHaveBeenCalledTimes(1);
  bridge.dispose();

  const without = createSessionBridge(fakeSession({}));
  expect(without.reloadExtensions()).toBe(false);
  without.dispose();
});

it("reads the source clone from the install marker only", () => {
  const dir = mkdtempSync(join(tmpdir(), "canvas-config-"));
  writeFileSync(join(dir, "template.config.json"), JSON.stringify({ sourceDir: "/evil" }));
  expect(readSourceDir(dir)).toBe("");

  const source = join(tmpdir(), "my-canvas");
  writeFileSync(join(dir, INSTALL_MARKER), JSON.stringify({ sourceDir: source }));
  expect(readSourceDir(dir)).toBe(source);

  writeFileSync(join(dir, INSTALL_MARKER), JSON.stringify({ sourceDir: "relative/path" }));
  expect(readSourceDir(dir)).toBe("");
});

it("replaces only installs of this canvas", async () => {
  const root = mkdtempSync(join(tmpdir(), "canvas-install-"));
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(join(source, "extension.mjs"), "");
  const options = { source, sourceDir: root, canvasId: "chat-panel" };

  const urlInstall = join(root, "url-install");
  mkdirSync(urlInstall);
  writeFileSync(join(urlInstall, "extension.mjs"), "");
  writeFileSync(join(urlInstall, "template.config.json"), '{"canvasId":"chat-panel"}');
  expect(isOwnInstall(urlInstall, "chat-panel")).toBe(true);
  await copyExtension({ ...options, target: urlInstall });
  expect(readSourceDir(urlInstall)).toBe(root);

  const other = join(root, "other");
  mkdirSync(other);
  writeFileSync(join(other, "template.config.json"), '{"canvasId":"someone-else"}');
  await expect(copyExtension({ ...options, target: other })).rejects.toThrow(/not this canvas/);
  await copyExtension({ ...options, target: other, force: true });
  expect(existsSync(join(other, INSTALL_MARKER))).toBe(true);
});

it("finds the phone URL for the gateway port in devtunnel host output", () => {
  const output = [
    "Hosting port: 47600",
    "Connect via browser: https://6r7f602k-47600.usw3.devtunnels.ms",
    "Inspect network activity: https://6r7f602k-47600-inspect.usw3.devtunnels.ms",
  ].join("\n");
  expect(parseForwardingUrl(output, 47600)).toBe("https://6r7f602k-47600.usw3.devtunnels.ms");
  expect(parseForwardingUrl(output, 3000)).toBeNull();
  expect(parseForwardingUrl("Hosting port: 47600", 47600)).toBeNull();
});

it("accepts only tunnels without extra access", () => {
  expect(isOwnerOnly('{"accessControlEntries":[]}')).toBe(true);
  expect(isOwnerOnly('{"accessControlEntries":[{"type":"Anonymous"}]}')).toBe(false);
  expect(isOwnerOnly("not json")).toBe(false);
  expect(isOwnerOnly("{}")).toBe(false);
});
