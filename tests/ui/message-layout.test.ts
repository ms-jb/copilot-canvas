import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

const css = (name: string) =>
  readFileSync(new URL(`../../ui/src/components/${name}.module.css`, import.meta.url), "utf8");

it("keeps the assistant body, thinking and tool rows on the column's left edge", () => {
  const message = css("Message");
  const body = /\.body\s*\{[^}]*\}/.exec(message)?.[0] ?? "";
  expect(body).not.toMatch(/padding-inline-start|margin-inline-start/);
  const group = /\.group\s*\{[^}]*\}/.exec(css("ActivityRows"))?.[0] ?? "";
  expect(group).not.toMatch(/padding-inline-start/);
  expect(css("ActivityRows")).not.toMatch(/\.group\s*\{\s*padding-inline-start/);
});
