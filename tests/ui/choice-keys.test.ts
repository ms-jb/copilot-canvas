import { expect, it } from "vite-plus/test";
import { choiceTarget } from "../../ui/src/features/prompts/choice-keys";

it("moves between choices with arrows, wrapping at the ends", () => {
  expect(choiceTarget("ArrowDown", 0, 3)).toBe(1);
  expect(choiceTarget("ArrowDown", 2, 3)).toBe(0);
  expect(choiceTarget("ArrowUp", 0, 3)).toBe(2);
  expect(choiceTarget("ArrowDown", -1, 3)).toBe(0);
  expect(choiceTarget("ArrowUp", -1, 3)).toBe(2);
});

it("jumps to a numbered choice and ignores other keys", () => {
  expect(choiceTarget("2", 0, 3)).toBe(1);
  expect(choiceTarget("4", 0, 3)).toBeNull();
  expect(choiceTarget("0", 0, 3)).toBeNull();
  expect(choiceTarget("a", 0, 3)).toBeNull();
  expect(choiceTarget("ArrowDown", 0, 0)).toBeNull();
});
