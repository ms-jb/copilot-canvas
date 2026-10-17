// Builds `extension/` from `extension-src/`: compiles the host `.mts` to `.mjs` with the local
// TypeScript and copies template.config.json. `extension/ui` belongs to the Vite build and is kept.

import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function syncExtension(root = repoRoot): Promise<void> {
  const target = join(root, "extension");
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(target)) {
    if (entry !== "ui") await rm(join(target, entry), { recursive: true, force: true });
  }

  const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.extension.json")], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`TypeScript emit failed:\n${result.stdout}${result.stderr}`);

  await cp(join(root, "template.config.json"), join(target, "template.config.json"));
}
