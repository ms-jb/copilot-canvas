import { parseInline } from "./inline";
import { MAX_DEPTH, type BlockNode, type Budget, type InlineNode } from "./model";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const HEADING_START = /^ {0,3}(#{1,6})(?=[ \t]|$)/u;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const BLOCKQUOTE_START = /^ {0,3}>/u;
const LIST_START = /^( *)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/u;
const CODE_LANG = /^[A-Za-z0-9_+#.-]{1,32}$/u;

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

export function parseBlocks(lines: string[], depth: number, budget: Budget): BlockNode[] {
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
