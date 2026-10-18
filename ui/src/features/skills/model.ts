import type { SkillSummary } from "../../shared";

/** Letters of `query` in order somewhere in `text`. */
const subsequence = (text: string, query: string) => {
  let at = 0;
  for (const letter of text) if (letter === query[at]) at += 1;
  return at === query.length;
};

/**
 * Skills `query` could mean, best first: exact name, name prefix, name substring, description
 * phrase, then the name's letters in order. Ties keep the session's order.
 */
export function rankSkills(skills: readonly SkillSummary[], rawQuery: string): SkillSummary[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return skills.slice();
  const tierOf = (skill: SkillSummary) => {
    const name = skill.name.toLowerCase();
    if (name === query) return 0;
    if (name.startsWith(query)) return 1;
    if (name.includes(query)) return 2;
    if (`${skill.description} ${skill.hint ?? ""}`.toLowerCase().includes(query)) return 3;
    return subsequence(name, query) ? 4 : -1;
  };
  return skills
    .map((skill, index) => ({ skill, index, tier: tierOf(skill) }))
    .filter((entry) => entry.tier >= 0)
    .sort((left, right) => left.tier - right.tier || left.index - right.index)
    .map((entry) => entry.skill);
}

export type PickerKey = "next" | "previous" | "pick" | "close";

/**
 * What a key does while the picker is open. Enter and Tab pick; Shift+Enter (newline) and
 * Ctrl/Cmd/Alt+Enter (send or queue as typed) are left to the composer.
 */
export function pickerKey(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}): PickerKey | null {
  if (event.isComposing) return null;
  const modified = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
  switch (event.key) {
    case "ArrowDown":
      return modified ? null : "next";
    case "ArrowUp":
      return modified ? null : "previous";
    case "Enter":
    case "Tab":
      return modified ? null : "pick";
    case "Escape":
      return "close";
    default:
      return null;
  }
}
