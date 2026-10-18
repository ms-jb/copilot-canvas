import { expect, it } from "vite-plus/test";
import { pickerKey, rankSkills } from "../../ui/src/features/skills/model";
import { insertSkill, insertSlash, slashTokenAt } from "../../ui/src/features/skills/slashToken";
import { parseSlashCommand } from "../../src/shared/contract.mts";

const skill = (name: string, description = "", hint: string | null = null) => ({
  name,
  description,
  hint,
});

const at = (draft: string) => {
  const caret = draft.indexOf("|");
  return [draft.slice(0, caret) + draft.slice(caret + 1), caret] as const;
};
const tokenAt = (draft: string, composing = false) => {
  const [text, caret] = at(draft);
  return slashTokenAt(text, caret, caret, composing);
};

it("finds the slash word at the caret anywhere in the draft", () => {
  expect(tokenAt("/|")).toEqual({ from: 0, to: 1, query: "" });
  expect(tokenAt("/gri|")).toEqual({ from: 0, to: 4, query: "gri" });
  expect(tokenAt("/gri| my plan")).toEqual({ from: 0, to: 4, query: "gri" });
  expect(tokenAt("/plugin:review|")?.query).toBe("plugin:review");
  expect(tokenAt("please /gri|")).toEqual({ from: 7, to: 11, query: "gri" });
  expect(tokenAt("please /|")).toEqual({ from: 7, to: 8, query: "" });
  expect(tokenAt(" /gri|")?.query).toBe("gri");
  expect(tokenAt("fix\t/td|d now")).toEqual({ from: 4, to: 8, query: "td" });
  // The caret mid-word filters by what is before it; a pick replaces the whole word.
  expect(tokenAt("use /gr|ill-me then")).toEqual({ from: 4, to: 13, query: "gr" });
  expect(tokenAt("use /|grill then")).toEqual({ from: 4, to: 10, query: "" });
});

it("reads slash words on any line of a multiline draft", () => {
  expect(tokenAt("first line\n/gri|")).toEqual({ from: 11, to: 15, query: "gri" });
  expect(tokenAt("first\n/tdd|\nthird")).toEqual({ from: 6, to: 10, query: "tdd" });
  expect(tokenAt("first\r\n  /a|")?.query).toBe("a");
});

it("ignores paths, URLs, fractions and mid-word slashes", () => {
  for (const draft of [
    "a/b|",
    "a/|",
    "see a/b| here",
    "http://x/y|",
    "http:/|",
    "http://|",
    "open https://example.com/pa|th",
    "~/x/y|",
    "~/|",
    "./x|",
    "../x|",
    "1/2|",
    "and/or|",
    "/usr|/bin",
    "/usr/bin|",
    "cd /usr/lo|cal/bin",
    "//|",
    "(/gri|",
    "`/gri|",
    "/gri |",
    "/gri my| plan",
    "|/gri",
    "|",
  ]) {
    expect(tokenAt(draft), draft).toBeNull();
  }
});

it("waits for a selection to collapse and an IME to commit", () => {
  expect(slashTokenAt("/gri", 1, 3)).toBeNull();
  expect(tokenAt("note /gri|", true)).toBeNull();
  expect(tokenAt("/日本|")).toBeNull();
  expect(tokenAt("日本 /gri|")?.query).toBe("gri");
});

it("replaces the slash word at the caret and keeps the rest of the draft", () => {
  const pick = (draft: string, name: string) => {
    const [text, caret] = at(draft);
    return insertSkill(text, slashTokenAt(text, caret, caret)!, name);
  };
  expect(pick("/|", "grill-me")).toEqual({ text: "/grill-me ", caret: 10 });
  expect(pick("/gri|", "grill-me")).toEqual({ text: "/grill-me ", caret: 10 });
  expect(pick("/| my plan", "grill-me")).toEqual({ text: "/grill-me my plan", caret: 10 });
  expect(pick("/gr|\nmore", "grill-me")).toEqual({ text: "/grill-me \nmore", caret: 10 });
  expect(pick("please /gr| my plan", "grill-me")).toEqual({
    text: "please /grill-me my plan",
    caret: 17,
  });
  expect(pick("use /g|ri then", "grill-me")).toEqual({ text: "use /grill-me then", caret: 14 });
  expect(pick("a\n/td|, b", "tdd")).toEqual({ text: "a\n/tdd , b", caret: 7 });
});

it("starts a slash word at the caret from the Skills button", () => {
  expect(insertSlash("", 0)).toEqual({ text: "/", caret: 1 });
  expect(insertSlash("my plan", 0)).toEqual({ text: "/ my plan", caret: 1 });
  expect(insertSlash("my plan", 7)).toEqual({ text: "my plan /", caret: 9 });
  expect(insertSlash("my plan ", 8)).toEqual({ text: "my plan /", caret: 9 });
  expect(insertSlash("my plan", 2)).toEqual({ text: "my / plan", caret: 4 });
  expect(insertSlash("my\nplan", 3)).toEqual({ text: "my\n/ plan", caret: 4 });
  expect(insertSlash("use /gri", 8)).toEqual({ text: "use /gri", caret: 8 });
});

it("ranks name matches before description matches, then loose letters, in session order", () => {
  const skills = [
    skill("tdd", "Test-driven development"),
    skill("review-pr", "Review one pull request"),
    skill("code-review", "Review a diff"),
    skill("research", "Research questions", "a topic"),
    skill("re"),
  ];
  const names = (query: string) => rankSkills(skills, query).map((entry) => entry.name);
  expect(names("")).toEqual(["tdd", "review-pr", "code-review", "research", "re"]);
  expect(names("RE")).toEqual(["re", "review-pr", "research", "code-review"]);
  expect(names("review")).toEqual(["review-pr", "code-review"]);
  expect(names("topic")).toEqual(["research"]);
  expect(names("rvw")).toEqual(["review-pr", "code-review"]);
  expect(names("zzz")).toEqual([]);
});

it("maps keys to picker moves and leaves modified Enter to the composer", () => {
  const key = (name: string, extra: Partial<Parameters<typeof pickerKey>[0]> = {}) =>
    pickerKey({
      key: name,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      ...extra,
    });
  expect(key("ArrowDown")).toBe("next");
  expect(key("ArrowUp")).toBe("previous");
  expect(key("Enter")).toBe("pick");
  expect(key("Tab")).toBe("pick");
  expect(key("Escape")).toBe("close");
  expect(key("Enter", { shiftKey: true })).toBeNull();
  expect(key("Enter", { ctrlKey: true })).toBeNull();
  expect(key("Enter", { metaKey: true })).toBeNull();
  expect(key("Tab", { shiftKey: true })).toBeNull();
  expect(key("Enter", { isComposing: true })).toBeNull();
  expect(key("a")).toBeNull();
});

it("reads a draft's slash command the way the host invokes it", () => {
  expect(parseSlashCommand("/grill-me")).toEqual({ name: "grill-me", input: "" });
  expect(parseSlashCommand("  /grill-me  my\nplan  ")).toEqual({
    name: "grill-me",
    input: "my\nplan",
  });
  expect(parseSlashCommand("/plugin:pdf a.pdf")).toEqual({ name: "plugin:pdf", input: "a.pdf" });
  for (const text of ["/", "/usr/bin/env", "hi /grill-me", "/bad*name x"]) {
    expect(parseSlashCommand(text), text).toBeNull();
  }
});
