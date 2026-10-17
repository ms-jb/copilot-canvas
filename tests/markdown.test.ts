import { expect, it } from "vite-plus/test";
import { parseMarkdown, sanitizeHref } from "../ui/src/markdown.ts";

// Collects link hrefs and literal text from the AST.
function walk(node: unknown, out = { hrefs: [] as string[], text: "" }) {
  if (Array.isArray(node)) node.forEach((child) => walk(child, out));
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (n.type === "link") out.hrefs.push(String(n.href));
    if (typeof n.value === "string") out.text += n.value;
    Object.values(n).forEach((value) => typeof value === "object" && walk(value, out));
  }
  return out;
}

it("renders supported syntax as plain data", () => {
  const tree = parseMarkdown(
    "# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```ts\nconst a = 1;\n```",
  );
  expect(tree.map((node) => node.type)).toEqual(["heading", "paragraph", "list", "codeBlock"]);
});

it("keeps raw HTML as literal text", () => {
  const { text } = walk(parseMarkdown('<script>alert(1)</script> <img src=x onerror="alert(1)">'));
  expect(text).toContain("<script>alert(1)</script>");
});

it("never turns javascript:, data: or protocol-relative links into hrefs", () => {
  for (const input of [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](//evil.example.test)",
    '<a href="javascript:alert(1)">x</a>',
  ]) {
    expect(walk(parseMarkdown(input)).hrefs).toEqual([]);
  }
});

it("allows only http, https and mailto links", () => {
  expect(sanitizeHref("https://example.test/a")).toBe("https://example.test/a");
  expect(sanitizeHref("mailto:someone@example.test")).toBe("mailto:someone@example.test");
  expect(sanitizeHref("ftp://example.test")).toBeNull();
  expect(walk(parseMarkdown("[ok](https://example.test)")).hrefs).toEqual([
    "https://example.test/",
  ]);
});

it("stays fast on pathological input", () => {
  const started = Date.now();
  parseMarkdown("*".repeat(20000) + "[".repeat(20000) + "`".repeat(20000));
  expect(Date.now() - started).toBeLessThan(2000);
});
