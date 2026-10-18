import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vite-plus/test";
import { inlineAppleTouchIcon } from "../scripts/inline-apple-touch-icon.mts";

const root = resolve(".");

it("inlines the apple-touch icon as a base64 data URI under the size budget", async () => {
  const html = await readFile(resolve(root, "ui", "index.html"), "utf8");
  const inlined = await inlineAppleTouchIcon(html, root);
  expect(inlined).toContain('rel="apple-touch-icon" href="data:image/png;base64,');
  expect(inlined.length).toBeLessThan(40 * 1024);
});
