import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { expect, it } from "vite-plus/test";
import { MarkdownView } from "../../ui/src/MarkdownView";
import { sanitizeHref } from "../../ui/src/markdown";

const render = (text: string) =>
  renderToStaticMarkup(createElement(MantineProvider, null, createElement(MarkdownView, { text })));

it("retains nested lists, quotations, tilde fences and leading tabs", () => {
  const html = render("> 3. outer\r\n>     - inner\r\n\r\n~~~ts\ncode\n~~~");
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<ol");
  expect(html).toContain("inner");
  expect(html).toContain("<code>code</code>");
  expect(render("- outer\n\t- inner")).toContain("inner");
});

it("keeps long unmatched delimiters and deeply nested text readable", () => {
  const html = render(`${"*x ".repeat(4000)}\n\n${"> ".repeat(40)}deep`);
  expect(html).toContain("deep");
  expect(html.length).toBeLessThan(100000);
});

it("rejects credentials, controls and oversized hrefs", () => {
  for (const href of [
    "https://user:password@example.test",
    "https://example.test/\u200b",
    `https://example.test/${"a".repeat(2048)}`,
  ])
    expect(sanitizeHref(href)).toBeNull();
});
