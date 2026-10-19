import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import { syncExtension } from "../scripts/sync-extension.mts";

it("syncs a standalone extension with a root entry, removing stale output but keeping the UI", async () => {
  const root = await mkdtemp(resolve(".build-test-"));
  try {
    for (const folder of ["src/host", "src/shared/node", "extension/ui", "extension/lib"]) {
      await mkdir(join(root, folder), { recursive: true });
    }
    await writeFile(join(root, "extension", "ui", "index.html"), "<p>built UI</p>");
    await writeFile(join(root, "extension", "lib", "old.mjs"), "export const stale = true;");
    await writeFile(join(root, "extension", "template.config.json"), '{"old":true}');
    const config = '{"canvasId":"build-test"}';
    await writeFile(join(root, "template.config.json"), config);
    await writeFile(
      join(root, "tsconfig.extension.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          rootDir: "src",
          outDir: "extension",
          rewriteRelativeImportExtensions: true,
          types: [],
          skipLibCheck: true,
        },
        include: ["src"],
      }),
    );
    await writeFile(
      join(root, "src", "extension.mts"),
      'export { value } from "./host/service.mts";',
    );
    await writeFile(
      join(root, "src", "host", "service.mts"),
      'export { value } from "../shared/node/config.mts";',
    );
    await writeFile(
      join(root, "src", "shared", "node", "config.mts"),
      'export const value = "configured";',
    );

    await syncExtension(root);

    const output = join(root, "extension");
    expect(existsSync(join(output, "lib"))).toBe(false);
    expect(await readFile(join(output, "ui", "index.html"), "utf8")).toBe("<p>built UI</p>");
    expect(await readFile(join(output, "template.config.json"), "utf8")).toBe(config);
    expect(await readFile(join(output, "extension.mjs"), "utf8")).toContain("./host/service.mjs");
    expect(await readFile(join(output, "host", "service.mjs"), "utf8")).toContain(
      "../shared/node/config.mjs",
    );
    expect(await readFile(join(output, "shared", "node", "config.mjs"), "utf8")).toContain(
      '"configured"',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
