const MAX_URL_LENGTH = 2048;
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
