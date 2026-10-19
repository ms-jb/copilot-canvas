import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createSessionBridge } from "../src/host/bridge.mts";
import type { SessionLike } from "../src/host/bridge.mts";
import { markerTime, watchInstall } from "../src/host/install-watch.mts";
import { INSTALL_MARKER, readSourceDir } from "../src/shared/node/config.mts";
import { validateReloadPayload } from "../src/shared/contract.mts";
import { isOwnerOnly, parseForwardingUrl, tunnelName } from "../scripts/devtunnel.mts";
import { copyExtension, isOwnInstall, promote } from "../scripts/install-ext.mts";
import { escapeStops } from "../ui/src/components/stopOnEscape.ts";

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

it("stops the turn only when the session confirms, and reports when it cannot", async () => {
  const abort = vi.fn(async () => ({ success: true }));
  const bridge = createSessionBridge(fakeSession({ abort }));
  expect(await bridge.stop()).toBe("stopped");
  expect(abort).toHaveBeenCalledWith({ reason: "user_initiated" });
  bridge.dispose();

  for (const reply of [
    async () => ({ success: false }),
    async () => undefined,
    async () => {
      throw new Error("gone");
    },
  ]) {
    const refused = createSessionBridge(fakeSession({ abort: reply }));
    expect(await refused.stop()).toBe("failed");
    refused.dispose();
  }

  const without = createSessionBridge(fakeSession({}));
  expect(await without.stop()).toBe("unavailable");
  without.dispose();
});

it("lets Escape stop only for a plain press that nothing else used", () => {
  const press = {
    key: "Escape",
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    modified: false,
    fromChat: true,
    overlayOpen: false,
  };
  expect(escapeStops(press)).toBe(true);
  for (const change of [
    { key: "Enter" },
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { modified: true },
    { fromChat: false },
    { overlayOpen: true },
  ]) {
    expect(escapeStops({ ...press, ...change })).toBe(false);
  }
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
  expect(readdirSync(root).filter((name) => name.endsWith(".installing"))).toEqual([]);
});

it("puts the previous install back when the new build cannot be swapped in", async () => {
  const root = mkdtempSync(join(tmpdir(), "canvas-promote-"));
  const target = join(root, "copilot-companion");
  const staging = join(root, ".copilot-companion.installing");
  mkdirSync(target);
  writeFileSync(join(target, "extension.mjs"), "old");
  mkdirSync(staging);
  writeFileSync(join(staging, "extension.mjs"), "new");
  const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
  const move = vi.fn(async (from: string, to: string) => {
    if (from === staging) throw busy;
    renameSync(from, to);
  });
  await expect(promote(staging, target, { move, delayMs: 0 })).rejects.toBe(busy);
  expect(readFileSync(join(target, "extension.mjs"), "utf8")).toBe("old");
  expect(move.mock.calls.filter(([from]) => from === staging)).toHaveLength(5);

  const flaky = vi.fn(async (from: string, to: string) => {
    if (from === staging && flaky.mock.calls.length < 3) throw busy;
    renameSync(from, to);
  });
  await promote(staging, target, { move: flaky, delayMs: 0 });
  expect(readFileSync(join(target, "extension.mjs"), "utf8")).toBe("new");
  expect(readdirSync(root).sort()).toEqual(["copilot-companion"]);
});

it("reloads a running canvas once a new build's marker lands, and stops watching on shutdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "canvas-watch-"));
  const marker = join(root, INSTALL_MARKER);
  const onInstall = vi.fn();
  const stop = watchInstall(marker, onInstall, { intervalMs: 10 });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
  await tick();
  expect(onInstall).not.toHaveBeenCalled();
  writeFileSync(marker, "{}");
  await vi.waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1), { timeout: 2000 });
  rmSync(marker);
  await tick();
  expect(onInstall).toHaveBeenCalledTimes(1);
  stop();
  writeFileSync(marker, '{"again":true}');
  await tick();
  expect(onInstall).toHaveBeenCalledTimes(1);
});

it("catches a build installed while the canvas was starting, and stays quiet on a normal start", () => {
  const root = mkdtempSync(join(tmpdir(), "canvas-watch-start-"));
  const marker = join(root, INSTALL_MARKER);
  writeFileSync(marker, "{}");
  const loaded = markerTime(marker);
  const quiet = vi.fn();
  watchInstall(marker, quiet, { baseline: loaded, intervalMs: 10_000 })();
  expect(quiet).not.toHaveBeenCalled();

  utimesSync(marker, new Date(), new Date(loaded + 60_000));
  const missed = vi.fn();
  watchInstall(marker, missed, { baseline: loaded, intervalMs: 10_000 })();
  expect(missed).toHaveBeenCalledTimes(1);
});

it("names a new tunnel after the computer's user, safe for a hostname", () => {
  expect(tunnelName("Jordan.Berger")).toBe("jordan-berger-canvas");
  expect(tunnelName("DOMAIN\\ann_lee ")).toBe("domain-ann-lee-canvas");
  expect(tunnelName("x".repeat(60))).toBe(`${"x".repeat(40)}-canvas`);
  expect(tunnelName("..")).toBeNull();
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
