// Where a `/skill` word sits in the draft, as the Copilot CLI reads one: at the start or after
// whitespace, anywhere in the text. Paths, URLs and fractions (`a/b`, `~/x`, `http://x/y`, `1/2`)
// never count, because their slash follows a non-blank character or another slash follows the word.

/** Characters a skill name can hold (SKILL_NAME in the contract). */
const NAME_CHAR = /[A-Za-z0-9_.:-]/;
const BLANK = /\s/;

export interface SlashToken {
  /** Index of the slash. */
  from: number;
  /** End of the whole word, which may run past the caret. */
  to: number;
  /** What is typed between the slash and the caret: the picker's filter. */
  query: string;
}

/**
 * The slash word the caret is in, or null: a selection, IME composition, a mid-word slash or a
 * path. The filter stops at the caret; a pick replaces the whole word.
 */
export function slashTokenAt(
  text: string,
  start: number,
  end: number,
  composing = false,
): SlashToken | null {
  if (composing || start !== end) return null;
  let from = start - 1;
  while (from >= 0 && NAME_CHAR.test(text[from]!)) from -= 1;
  if (from < 0 || text[from] !== "/") return null;
  if (from > 0 && !BLANK.test(text[from - 1]!)) return null;
  let to = start;
  while (to < text.length && NAME_CHAR.test(text[to]!)) to += 1;
  if (text[to] === "/") return null;
  return { from, to, query: text.slice(from + 1, start) };
}

export interface DraftEdit {
  text: string;
  caret: number;
}

/**
 * The draft with `token` replaced by `/name` and a space, keeping everything around it. An
 * existing space after the word is reused; the caret lands after the space, ready for more text.
 */
export function insertSkill(text: string, token: SlashToken, name: string): DraftEdit {
  const command = `/${name}`;
  const after = text.slice(token.to);
  const space = /^[ \t]/.test(after) ? "" : " ";
  return {
    text: text.slice(0, token.from) + command + space + after,
    caret: token.from + command.length + 1,
  };
}

/**
 * The Skills button: a `/` at the caret, spaced from the words on either side so it starts a new
 * word, or the draft unchanged when the caret is already in a slash word.
 */
export function insertSlash(text: string, caret: number): DraftEdit {
  if (slashTokenAt(text, caret, caret)) return { text, caret };
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before && !BLANK.test(before.at(-1)!) ? " " : "";
  const trail = after && !BLANK.test(after[0]!) ? " " : "";
  return {
    text: `${before}${lead}/${trail}${after}`,
    caret: caret + lead.length + 1,
  };
}
