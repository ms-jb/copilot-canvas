// A short plain-text preview of a Markdown reply for a notification: no code blocks, tables, URLs,
// HTML or Markdown marks; list items and lines become sentences.

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*(?=\n|$)|$)/gm;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const LONG_INLINE_CODE = 40;

function plainLine(line: string): string {
  return (
    line
      // Images keep their description, links their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<(?:https?:\/\/|mailto:)[^>]*>/gi, "")
      .replace(/\bhttps?:\/\/\S+/gi, "")
      // Short code reads as words; long code (paths, commands) is left to the screen.
      .replace(/`([^`\n]*)`/g, (_match, code: string) =>
        code.length > LONG_INLINE_CODE ? "" : code,
      )
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(?:>\s*)+/, "")
      .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Cuts at the last sentence end that fits, else the last word, and marks the cut. */
function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= maxChars / 2) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * The words of a Markdown reply worth showing in a notification, capped at `maxChars` on a sentence
 * boundary when it can be. Returns "" when nothing is left (for example a reply that is only code).
 */
export function previewText(markdown: string, maxChars: number): string {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(FENCE, "\n")
    .split("\n")
    .filter((line) => !TABLE_ROW.test(line) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
    .map(plainLine)
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
  const joined = lines
    .map((line) => (/[.!?:;…]["')\]]?$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  return cap(joined, maxChars);
}
