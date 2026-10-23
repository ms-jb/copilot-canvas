import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync("ui/src/components/Composer.module.css", "utf8");

test("a disabled Send or Stop keeps a visible fill and inverse ink", () => {
  const rule = /\n\.send \{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toContain("--mantine-color-disabled: var(--cc-text-faint)");
  expect(rule).toContain("--mantine-color-disabled-color: var(--cc-surface)");
  expect(rule).toContain("--mantine-color-disabled-border: var(--cc-text-faint)");
});
