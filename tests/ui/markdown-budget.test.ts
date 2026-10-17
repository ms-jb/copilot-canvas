import { expect, it } from "vite-plus/test";
import { parseMarkdown } from "../../ui/src/markdown";
import { parseBlocks } from "../../ui/src/features/markdown/blocks";
import { parseInline } from "../../ui/src/features/markdown/inline";
import { sanitizeHref, trimBareUrl } from "../../ui/src/features/markdown/links";
import { MAX_DEPTH } from "../../ui/src/features/markdown/model";

it("keeps one inline scan budget across separate blocks", () => {
  const budget = { remaining: 1 };
  expect(parseBlocks(["*x", "", "**bold**"], 0, budget)).toEqual([
    { type: "paragraph", children: [{ type: "text", value: "*x" }] },
    { type: "paragraph", children: [{ type: "text", value: "**bold**" }] },
  ]);
  expect(budget.remaining).toBe(0);
});

it("degrades inline syntax to literal text when the shared budget is exhausted", () => {
  const text = "**bold** [label](https://example.test) `code` https://example.test";
  expect(parseInline(text, 0, { remaining: 0 }, false)).toEqual([{ type: "text", value: text }]);
});

it("bounds nesting and keeps block content readable at the limit", () => {
  expect(parseBlocks(["  **deep**", " text  "], MAX_DEPTH + 1, { remaining: 100 })).toEqual([
    {
      type: "paragraph",
      children: [
        { type: "text", value: "**deep**" },
        { type: "break" },
        { type: "text", value: "text" },
      ],
    },
  ]);
  expect(parseInline("**deep**", MAX_DEPTH, { remaining: 100 }, false)).toEqual([
    { type: "text", value: "**deep**" },
  ]);
});

it("retains nested lists, quotations, fences and leading tab expansion", () => {
  expect(parseMarkdown("> 3. outer\r\n>     - inner\r\n\r\n~~~ts\ncode\n~~~")).toEqual([
    {
      type: "blockquote",
      children: [
        {
          type: "list",
          ordered: true,
          start: 3,
          items: [
            [
              { type: "paragraph", children: [{ type: "text", value: "outer" }] },
              {
                type: "list",
                ordered: false,
                items: [[{ type: "paragraph", children: [{ type: "text", value: "inner" }] }]],
              },
            ],
          ],
        },
      ],
    },
    { type: "codeBlock", lang: "ts", value: "code" },
  ]);
  expect(parseMarkdown("- outer\n\t- inner")).toEqual(parseMarkdown("- outer\n    - inner"));
});

it("retains URL punctuation and safety limits", () => {
  expect(trimBareUrl("https://example.test/a(b)).")).toBe("https://example.test/a(b)");
  for (const href of [
    "https://user:password@example.test",
    "https://example.test/\u200b",
    `https://example.test/${"a".repeat(2048)}`,
  ]) {
    expect(sanitizeHref(href)).toBeNull();
  }
});
