// A small, original, allow-list Markdown parser for assistant text.
//
// Safety model: the output is an AST of plain data. Nothing here ever produces HTML; the React
// renderer turns text nodes into React text (which escapes them) and builds elements from a fixed
// set of node types. Raw HTML in the input is therefore just text (`<script>` is shown literally),
// entities are never decoded, and the only attribute derived from input is a link `href` that has
// passed `sanitizeHref` (http, https and mailto only).
//
// The parser is linear in practice: scanning for closing markers is charged against a shared
// budget, so pathological input (thousands of unclosed markers) degrades to literal text instead of
// burning CPU, and nesting is capped.
import { parseBlocks } from "./blocks";
import type { Budget, MarkdownNode } from "./model";

/** Parses Markdown text into a safe block AST. Pure and total: never throws on any string input. */
export function parseMarkdown(text: string): MarkdownNode[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/).map(expandLeadingTabs);
  const budget: Budget = { remaining: 200_000 + text.length * 20 };
  return parseBlocks(lines, 0, budget);
}

function expandLeadingTabs(line: string): string {
  let end = 0;
  while (end < line.length && (line[end] === " " || line[end] === "\t")) end += 1;
  if (end === 0 || !line.slice(0, end).includes("\t")) return line;
  return line.slice(0, end).replaceAll("\t", "    ") + line.slice(end);
}
