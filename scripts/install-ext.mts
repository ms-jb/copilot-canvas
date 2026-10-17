// Builds the extension and installs `extension/` into <COPILOT_HOME|~/.copilot>/extensions/<name>.
// Usage: node scripts/install-ext.mts [name] [--force] [--dir <extensions-root>]
// The name is the argument, else EXTENSION_NAME, else template.config.json.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { copilotHome, loadConfig } from "../extension-src/shared/config.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".installed-by-template.json";

/** Copies `source` to `target`. Refuses to replace a folder this script did not create. */
export async function copyExtension(source: string, target: string, force = false): Promise<void> {
  if (existsSync(target) && !existsSync(join(target, MARKER)) && !force) {
    throw new Error(
      `${target} exists and was not installed by this template. Use --force to replace it.`,
    );
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  await writeFile(join(target, MARKER), "{}\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { force: { type: "boolean" }, dir: { type: "string" } },
  });
  const name = positionals[0] ?? loadConfig(repoRoot).extensionName;
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
  await copyExtension(join(repoRoot, "extension"), target, values.force);
  console.log(
    `Installed to ${target}\nReload extensions in the Copilot app, then open the canvas.`,
  );
}
