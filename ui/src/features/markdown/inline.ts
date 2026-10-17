import { matchLink, sanitizeHref, trimBareUrl } from "./links";
import { MAX_DEPTH, type Budget, type InlineNode } from "./model";

const ESCAPABLE = "\\`*_{}[]()#+-.!~|>";
const WORD_CHAR = /[\p{L}\p{N}]/u;
const BARE_URL = /https?:\/\/[^\s<>"]{1,2049}/iy;

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

export function parseInline(
  src: string,
  depth: number,
  budget: Budget,
  inLink: boolean,
): InlineNode[] {
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
