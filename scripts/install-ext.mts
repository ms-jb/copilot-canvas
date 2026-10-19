// Builds the extension and installs `extension/` into <COPILOT_HOME|~/.copilot>/extensions/<name>.
// Usage: node scripts/install-ext.mts [name] [--force] [--dir <extensions-root>]
// The name is the argument, else EXTENSION_NAME, else template.config.json.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { copilotHome, INSTALL_MARKER, loadConfig } from "../src/shared/node/config.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True when `target` holds this canvas: installed by this script, or from a URL (same canvas id). */
export function isOwnInstall(target: string, canvasId: string): boolean {
  if (existsSync(join(target, INSTALL_MARKER))) return true;
  try {
    const raw = JSON.parse(readFileSync(join(target, "template.config.json"), "utf8")) as {
      canvasId?: unknown;
    };
    return raw.canvasId === canvasId && existsSync(join(target, "extension.mjs"));
  } catch {
    return false;
  }
}

/**
 * Copies `source` to `target` and records `sourceDir`, the clone it came from, in the install marker.
 * The build is staged beside `target` and swapped in whole, marker included, so a running canvas
 * (which watches the marker and reloads itself) never sees a half-copied install.
 * Refuses to replace a folder that is not this canvas unless `force` is set.
 */
export async function copyExtension(options: {
  source: string;
  target: string;
  sourceDir: string;
  canvasId: string;
  force?: boolean;
}): Promise<void> {
  const { source, target, sourceDir, canvasId, force = false } = options;
  if (existsSync(target) && !isOwnInstall(target, canvasId) && !force) {
    throw new Error(
      `${target} exists and is not this canvas. Remove it or pass --force to replace it.`,
    );
  }
  const staging = join(dirname(target), `.${basename(target)}.installing`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, staging, { recursive: true });
  await writeFile(
    join(staging, INSTALL_MARKER),
    JSON.stringify({ sourceDir, installedAt: new Date().toISOString() }) + "\n",
  );
  await promote(staging, target);
}

type Move = (from: string, to: string) => Promise<void>;
const TRANSIENT = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

async function retry(action: () => Promise<void>, delayMs: number, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
      if (attempt >= attempts || !TRANSIENT.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/**
 * Swaps `staging` in as `target`. The previous install is kept aside until the swap succeeds and
 * put back if it fails, retrying the short-lived sharing errors Windows reports.
 */
export async function promote(
  staging: string,
  target: string,
  { move = rename as Move, delayMs = 200 }: { move?: Move; delayMs?: number } = {},
): Promise<void> {
  const previous = join(dirname(target), `.${basename(target)}.previous`);
  await rm(previous, { recursive: true, force: true });
  const replacing = existsSync(target);
  if (replacing) await retry(() => move(target, previous), delayMs);
  try {
    await retry(() => move(staging, target), delayMs);
  } catch (error) {
    if (replacing) await retry(() => move(previous, target), delayMs).catch(() => {});
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { force: { type: "boolean" }, dir: { type: "string" } },
  });
  const config = loadConfig(repoRoot);
  const name = positionals[0] ?? config.extensionName;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid extension name: ${name}`);
  }

  const vp = join(repoRoot, "node_modules", "vite-plus", "bin", "vp");
  if (
    spawnSync(process.execPath, [vp, "build"], { cwd: repoRoot, stdio: "inherit" }).status !== 0
  ) {
    throw new Error("Build failed; nothing was installed.");
  }

  const target = join(resolve(values.dir ?? join(copilotHome(), "extensions")), name);
  await copyExtension({
    source: join(repoRoot, "extension"),
    target,
    sourceDir: repoRoot,
    canvasId: config.canvasId,
    force: values.force,
  });
  console.log(
    `Installed to ${target}\nAn open canvas reloads itself onto this build in a few seconds; ` +
      "then open it again. A first install needs one extensions reload to register it.",
  );
}
