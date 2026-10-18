import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { expect, it } from "vite-plus/test";
import { sanitizeHref } from "../ui/src/markdown.ts";
import { MarkdownView } from "../ui/src/MarkdownView.tsx";

const render = (text: string, streaming = false, size?: "sm") =>
  renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(MarkdownView, { text, streaming, size })),
  );
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

it("renders supported syntax", () => {
  const html = render(
    "# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```ts\nconst a = 1;\n```",
  );
  expect(html).toContain('role="heading" aria-level="3"');
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<code>code</code>");
  expect(html).toMatch(/<ul><li>one<\/li><li>two<\/li><\/ul>/);
  expect(html).toContain("<code>const a = 1;</code>");
  expect(html).toContain(">ts<");
  expect(render("```\nconst a = 1;\n```")).not.toContain(">text<");
});

it("keeps the language label for unknown fences and falls back to plain code", () => {
  const html = render("```brainfuck\n+[-->-[>>+>-----<<]<--<---]>-.>>>+.>++.\n```");
  expect(html).toContain(">brainfuck<");
  expect(html).toContain(
    "<code>+[--&gt;-[&gt;&gt;+&gt;-----&lt;&lt;]&lt;--&lt;---]&gt;-.&gt;&gt;&gt;+.&gt;++.</code>",
  );
});

it("renders a GFM table in its own scroll container, with alignment and inline syntax", () => {
  const html = render(
    "| Agent | Status |\n|---|:-:|\n| `skills` | ~~blocked~~ **done** |\n| a \\| b | ok |",
  );
  expect(html).not.toContain("|---|");
  expect(html).toMatch(/--table-min-width:calc\(13.75rem[^>]*TableScrollContainer[^>]*>.*<table/s);
  expect(html.match(/<th\b/g)).toHaveLength(2);
  expect(html.match(/<td\b/g)).toHaveLength(4);
  expect(html).toContain("<code>skills</code>");
  expect(html).toContain("<del>blocked</del>");
  expect(html).toMatch(/<td[^>]*>a \| b<\/td>/);
  expect(html).toMatch(/<th[^>]*text-align:center[^>]*>Status<\/th>/);
});

it("renders task lists as read-only marks and bare URLs as links", () => {
  const html = render("- [x] shipped\n- [ ] review\n\nSee https://example.test/a.");
  expect(html).not.toContain("<input");
  expect(html).toContain("Done: ");
  expect(html).toContain("Not done: ");
  expect(hrefs(html)).toEqual(["https://example.test/a"]);
});

it("keeps raw HTML as literal text and never fetches images", () => {
  const html = render(
    '<script>alert(1)</script> <img src=x onerror="alert(1)">\n\n![cat](https://x.test/c.png)',
  );
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toMatch(/<(script|img)\b/);
  expect(html).toContain("Image: cat");
});

it("never turns javascript:, data: or protocol-relative links into hrefs", () => {
  for (const input of [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](//evil.example.test)",
    "<javascript:alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
  ]) {
    expect(hrefs(render(input))).toEqual([]);
  }
});

it("allows only http, https and mailto links", () => {
  expect(sanitizeHref("https://example.test/a")).toBe("https://example.test/a");
  expect(sanitizeHref("mailto:someone@example.test")).toBe("mailto:someone@example.test");
  expect(sanitizeHref("ftp://example.test")).toBeNull();
  for (const href of ["https://example.test/\u200b", `https://example.test/${"a".repeat(2048)}`]) {
    expect(sanitizeHref(href)).toBeNull();
  }
  expect(hrefs(render("[ok](https://example.test)"))).toEqual(["https://example.test/"]);
});

it("holds back unclosed syntax while streaming and renders nothing for no text", () => {
  expect(render("some **bol", true)).not.toContain("**");
  expect(render("", true)).toMatch(/<div class="[^"]*md[^"]*" data-streaming="true"><\/div>$/);
});

it("renders text cut off mid-syntax, as shortened agent replies are, without losing it", () => {
  const fence = render("Pushed **921a34c**.\n\n```ts\nconst a = 1;\nconst b…");
  expect(fence).toContain("<strong>921a34c</strong>");
  expect(fence).toContain("<code>const a = 1;\nconst b…</code>");
  expect(render("a `cod…")).toContain("a `cod…");
  expect(render("Some **bold wor…")).toContain("Some **bold wor…");
  expect(render("x", false, "sm")).toContain('data-size="sm"');
});

it("stays fast on pathological input", () => {
  const started = Date.now();
  render("*".repeat(20000) + "[".repeat(20000) + "`".repeat(20000));
  render(">".repeat(5000) + " x\n" + "- ".repeat(3000) + "x");
  render("| a |\n|---|\n" + "| x |\n".repeat(5000));
  expect(Date.now() - started).toBeLessThan(4000);
});
