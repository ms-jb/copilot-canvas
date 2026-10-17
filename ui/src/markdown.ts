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

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "emphasis"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "break" };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: "codeBlock"; lang?: string; value: string }
  | { type: "list"; ordered: boolean; start?: number; items: BlockNode[][] }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "rule" };

export type MarkdownNode = BlockNode;

const MAX_DEPTH = 6;
const MAX_LINK_TEXT = 1000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;

interface Budget {
  remaining: number;
}

const ESCAPABLE = "\\`*_{}[]()#+-.!~|>";
const TRAILING_URL_PUNCTUATION = ".,;:!?*_~'\"]";
const WORD_CHAR = /[\p{L}\p{N}]/u;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const HEADING_START = /^ {0,3}(#{1,6})(?=[ \t]|$)/u;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const BLOCKQUOTE_START = /^ {0,3}>/u;
const LIST_START = /^( *)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/u;
const BARE_URL = /https?:\/\/[^\s<>"]{1,2049}/iy;
// Control characters are the point of this expression: they must never appear in a URL.
const UNSAFE_URL_CHARS =
  // oxlint-disable-next-line no-control-regex
  /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\ufeff"<>\\`]/u;
const CODE_LANG = /^[A-Za-z0-9_+#.-]{1,32}$/u;

/** Returns a normalized, safe absolute URL for http(s)/mailto, or null for anything else. */
export function sanitizeHref(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(url)) {
    return null;
  }
  if (/^mailto:[^?#]/i.test(url)) {
    return url;
  }
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.hostname.length === 0 ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

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

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function indentOf(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function isFenceOpen(line: string): boolean {
  const match = FENCE_OPEN.exec(line);
  return match !== null && !(match[1]![0] === "`" && match[2]!.includes("`"));
}

// A paragraph is interrupted by other blocks; per CommonMark only "1." may interrupt it as a list.
function startsBlock(line: string, interrupting: boolean): boolean {
  if (
    isFenceOpen(line) ||
    HEADING_START.test(line) ||
    RULE.test(line) ||
    BLOCKQUOTE_START.test(line)
  ) {
    return true;
  }
  const list = LIST_START.exec(line);
  if (!list) return false;
  if (!interrupting) return true;
  const marker = list[2]!;
  return !/^\d/.test(marker) || parseInt(marker, 10) === 1;
}

function plainParagraph(lines: string[]): BlockNode[] {
  const children: InlineNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push({ type: "break" });
    if (line.length > 0) children.push({ type: "text", value: line });
  });
  return children.length > 0 ? [{ type: "paragraph", children }] : [];
}

function parseBlocks(lines: string[], depth: number, budget: Budget): BlockNode[] {
  if (depth > MAX_DEPTH) {
    return plainParagraph(lines.map((line) => line.trim()));
  }
  const blocks: BlockNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (isFenceOpen(line)) {
      const open = FENCE_OPEN.exec(line)!;
      const fence = open[1]!;
      const indent = indentOf(line);
      const info = open[2]!.trim().split(/\s/u, 1)[0] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]!);
        if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
          i += 1;
          break;
        }
        body.push(lines[i]!.slice(Math.min(indent, indentOf(lines[i]!))));
        i += 1;
      }
      const node: BlockNode = { type: "codeBlock", value: body.join("\n") };
      if (CODE_LANG.test(info)) node.lang = info;
      blocks.push(node);
      continue;
    }

    const heading = HEADING_START.exec(line);
    if (heading) {
      let content = line.slice(heading[0].length).trim();
      content = content.replace(/[ \t]#+$/u, "").trim();
      if (/^#+$/u.test(content)) content = "";
      const level = Math.min(heading[1]!.length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, children: parseInline(content, 0, budget, false) });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (BLOCKQUOTE_START.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && BLOCKQUOTE_START.test(lines[i]!)) {
        const stripped = lines[i]!.replace(/^ {0,3}> ?/u, "");
        inner.push(stripped);
        i += 1;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(inner, depth + 1, budget) });
      continue;
    }

    if (LIST_START.test(line)) {
      const result = parseList(lines, i, depth, budget);
      blocks.push(result.node);
      i = result.next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines[i]!, true)) {
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({
      type: "paragraph",
      children: parseInline(paragraph.join("\n"), 0, budget, false),
    });
  }
  return blocks;
}

function parseList(
  lines: string[],
  start: number,
  depth: number,
  budget: Budget,
): { node: BlockNode; next: number } {
  const first = LIST_START.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /^\d/.test(first[2]!);
  const items: BlockNode[][] = [];
  const startNumber = ordered ? parseInt(first[2]!, 10) : undefined;
  let i = start;

  while (i < lines.length) {
    const marker = LIST_START.exec(lines[i]!);
    if (!marker || marker[1]!.length > baseIndent || /^\d/.test(marker[2]!) !== ordered) break;

    const itemLines: string[] = [lines[i]!.slice(marker[0].length).replace(/^[ \t]+/u, "")];
    const continuation: string[] = [];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      if (isBlank(next)) {
        let look = i + 1;
        while (look < lines.length && isBlank(lines[look]!)) look += 1;
        if (look < lines.length && indentOf(lines[look]!) > baseIndent) {
          continuation.push("");
          i += 1;
          continue;
        }
        break;
      }
      if (indentOf(next) > baseIndent) {
        continuation.push(next);
        i += 1;
        continue;
      }
      break;
    }

    const nonBlank = continuation.filter((line) => !isBlank(line));
    const strip = nonBlank.length > 0 ? Math.min(...nonBlank.map(indentOf)) : 0;
    for (const line of continuation) itemLines.push(line.slice(Math.min(strip, indentOf(line))));
    items.push(parseBlocks(itemLines, depth + 1, budget));
  }

  const node: BlockNode = { type: "list", ordered, items };
  if (startNumber !== undefined && startNumber !== 1) node.start = startNumber;
  return { node, next: i };
}

function runLength(src: string, index: number, char: string): number {
  let end = index;
  while (end < src.length && src[end] === char) end += 1;
  return end - index;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/u.test(char);
}

function parseInline(src: string, depth: number, budget: Budget, inLink: boolean): InlineNode[] {
  const out: InlineNode[] = [];
  const length = src.length;
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < length) {
    const char = src[i]!;

    if (char === "\\") {
      const next = src[i + 1];
      if (next !== undefined && ESCAPABLE.includes(next)) {
        buffer += next;
        i += 2;
      } else {
        buffer += char;
        i += 1;
      }
      continue;
    }

    if (char === "\n") {
      flush();
      out.push({ type: "break" });
      i += 1;
      continue;
    }

    if (char === "`") {
      const span = matchCodeSpan(src, i, budget);
      if (span) {
        flush();
        out.push({ type: "code", value: span.value });
        i = span.end;
      } else {
        const run = runLength(src, i, "`");
        buffer += src.slice(i, i + run);
        i += run;
      }
      continue;
    }

    if (char === "*" || char === "_") {
      const run = runLength(src, i, char);
      const emphasis =
        run <= 3 && depth < MAX_DEPTH
          ? matchEmphasis(src, i, run, char, depth, budget, inLink)
          : null;
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        i = emphasis.end;
      } else {
        buffer += src.slice(i, i + run);
        i += run;
      }
      continue;
    }

    if (char === "[" || (char === "!" && src[i + 1] === "[")) {
      const isImage = char === "!";
      const link =
        depth < MAX_DEPTH && !inLink ? matchLink(src, isImage ? i + 1 : i, budget) : null;
      if (link) {
        flush();
        const href = sanitizeHref(link.dest);
        if (isImage) {
          const label = link.text.length > 0 ? link.text : "image";
          out.push(
            href
              ? { type: "link", href, children: [{ type: "text", value: label }] }
              : { type: "text", value: label },
          );
        } else {
          const children = parseInline(link.text, depth + 1, budget, true);
          if (href) out.push({ type: "link", href, children });
          else out.push(...children);
        }
        i = link.end;
        continue;
      }
    }

    if (
      (char === "h" || char === "H") &&
      !inLink &&
      !isWordChar(src[i - 1]) &&
      budget.remaining > 0
    ) {
      BARE_URL.lastIndex = i;
      const found = BARE_URL.exec(src);
      if (found) {
        budget.remaining -= found[0].length;
        const url = trimBareUrl(found[0]);
        const href = sanitizeHref(url);
        if (href) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", value: url }] });
          i += url.length;
          continue;
        }
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return out;
}

function trimBareUrl(url: string): string {
  let end = url.length;
  let opens = 0;
  let closes = 0;
  for (const char of url) {
    if (char === "(") opens += 1;
    else if (char === ")") closes += 1;
  }
  while (end > 0) {
    const last = url[end - 1]!;
    if (TRAILING_URL_PUNCTUATION.includes(last)) {
      end -= 1;
    } else if (last === ")" && closes > opens) {
      end -= 1;
      closes -= 1;
    } else {
      break;
    }
  }
  return url.slice(0, end);
}

function matchCodeSpan(
  src: string,
  index: number,
  budget: Budget,
): { value: string; end: number } | null {
  const run = runLength(src, index, "`");
  let cursor = index + run;
  while (cursor < src.length && budget.remaining > 0) {
    const found = src.indexOf("`", cursor);
    if (found === -1) {
      budget.remaining -= src.length - cursor;
      return null;
    }
    budget.remaining -= found - cursor;
    const closing = runLength(src, found, "`");
    if (closing === run) {
      let value = src.slice(index + run, found);
      if (value.length > 1 && value.startsWith(" ") && value.endsWith(" ") && value.trim()) {
        value = value.slice(1, -1);
      }
      return { value: value.replaceAll("\n", " "), end: found + run };
    }
    cursor = found + closing;
  }
  return null;
}

function matchEmphasis(
  src: string,
  index: number,
  run: number,
  char: string,
  depth: number,
  budget: Budget,
  inLink: boolean,
): { node: InlineNode; end: number } | null {
  const contentStart = index + run;
  if (isSpace(src[contentStart]) || (char === "_" && isWordChar(src[index - 1]))) {
    return null;
  }
  let cursor = contentStart;
  while (cursor < src.length && budget.remaining > 0) {
    budget.remaining -= 1;
    const current = src[cursor]!;
    if (current === "\\") {
      cursor += 2;
      continue;
    }
    if (current === char) {
      const closing = runLength(src, cursor, char);
      const flanked =
        closing === run &&
        cursor > contentStart &&
        !isSpace(src[cursor - 1]) &&
        (char === "*" || !isWordChar(src[cursor + closing]));
      if (flanked) {
        const inner = parseInline(src.slice(contentStart, cursor), depth + 1, budget, inLink);
        const node: InlineNode =
          run === 1
            ? { type: "emphasis", children: inner }
            : run === 2
              ? { type: "strong", children: inner }
              : { type: "emphasis", children: [{ type: "strong", children: inner }] };
        return { node, end: cursor + closing };
      }
      cursor += closing;
      continue;
    }
    cursor += 1;
  }
  return null;
}

function matchLink(
  src: string,
  open: number,
  budget: Budget,
): { text: string; dest: string; end: number } | null {
  if (budget.remaining <= 0) return null;
  const textLimit = Math.min(src.length, open + 1 + MAX_LINK_TEXT);
  let close = open + 1;
  while (close < textLimit && src[close] !== "]") {
    if (src[close] === "[") return null;
    close += src[close] === "\\" ? 2 : 1;
  }
  if (close >= textLimit || src[close] !== "]" || src[close + 1] !== "(") {
    return null;
  }

  const destStart = close + 2;
  const destLimit = Math.min(src.length, destStart + MAX_URL_LENGTH + 1);
  let cursor = destStart;
  let nesting = 0;
  while (cursor < destLimit) {
    const char = src[cursor]!;
    if (char === "(") nesting += 1;
    else if (char === ")") {
      if (nesting === 0) break;
      nesting -= 1;
    } else if (/\s/u.test(char)) break;
    cursor += 1;
  }
  budget.remaining -= cursor - destStart;
  if (cursor >= src.length) return null;
  const dest = src.slice(destStart, cursor);

  if (src[cursor] !== ")") {
    // Optional link title: skip whitespace, an optional quoted title, then require ")".
    while (cursor < src.length && /\s/u.test(src[cursor]!)) cursor += 1;
    const quote = src[cursor];
    if (quote === '"' || quote === "'") {
      const titleEnd = src.indexOf(quote, cursor + 1);
      if (titleEnd === -1 || titleEnd - cursor > MAX_TITLE_LENGTH) return null;
      cursor = titleEnd + 1;
      while (cursor < src.length && /\s/u.test(src[cursor]!)) cursor += 1;
    }
    if (src[cursor] !== ")") return null;
  }

  return { text: src.slice(open + 1, close), dest, end: cursor + 1 };
}
