import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("menu items are 44px tall on touch screens and phones", () => {
  const css = readFileSync("ui/src/theme.module.css", "utf8");
  expect(css).toMatch(
    /@media \(max-width: 768px\), \(pointer: coarse\) \{[^@]*\.touchRow \{[^}]*min-height: 44px/,
  );
  expect(readFileSync("ui/src/theme.ts", "utf8")).toContain(
    "Menu: { classNames: { item: classes.touchRow } }",
  );
});
