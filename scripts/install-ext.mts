// Builds the extension and installs `extension/` into <COPILOT_HOME|~/.copilot>/extensions/<name>.
// Usage: node scripts/install-ext.mts [name] [--force] [--dir <extensions-root>]
// The name is the argument, else EXTENSION_NAME, else template.config.json.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { copilotHome, INSTALL_MARKER, loadConfig } from "../extension-src/shared/config.mts";

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
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  await writeFile(join(target, INSTALL_MARKER), JSON.stringify({ sourceDir }) + "\n");
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
    `Installed to ${target}\nReload extensions (the canvas's reload button, or the Copilot app), ` +
      "then open the canvas.",
  );
}
