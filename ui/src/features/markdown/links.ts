import type { Budget } from "./model";

const MAX_LINK_TEXT = 1000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const TRAILING_URL_PUNCTUATION = ".,;:!?*_~'\"]";
// Control characters are the point of this expression: they must never appear in a URL.
const UNSAFE_URL_CHARS =
  // oxlint-disable-next-line no-control-regex
  /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\ufeff"<>\\`]/u;

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

export function trimBareUrl(url: string): string {
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

export function matchLink(
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
