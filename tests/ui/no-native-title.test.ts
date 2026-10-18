import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vite-plus/test";

const UI = join(import.meta.dirname, "../../ui/src");

/** Elements a person presses. A `title` on one is a second, native tooltip next to Mantine's. */
const INTERACTIVE = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "ActionIcon",
  "Anchor",
  "Button",
  "Checkbox",
  "Chip",
  "CloseButton",
  "ComposerIconButton",
  "FileButton",
  "NavLink",
  "Switch",
  "UnstyledButton",
  "Menu.Item",
  "Tabs.Tab",
]);

/**
 * Files that still carry a native `title` on a pressable element. Only this list may shrink: move
 * the label into `aria-label` and a `ComposerTooltip`/Mantine `Tooltip`, then delete the entry.
 */
const LEGACY = new Set(["components/SendButton.tsx", "components/QueuedMessages.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => join(dir, name));
}

/** The opening tag's own attributes, with anything inside `{}` or quotes left out. */
function attributesFrom(source: string, from: number): string {
  let depth = 0;
  let quote = "";
  let own = "";
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || (char === "`" && depth > 0)) quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return own;
    else if (depth === 0) own += char;
  }
  return own;
}

/** `<Tag ... title=...>` for every pressable tag (or any tag with `onClick`) in one file. */
export function nativeTitles(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const tag = match[1];
    const attributes = attributesFrom(source, match.index + match[0].length);
    const pressable = INTERACTIVE.has(tag) || /(^|\s)onClick=/.test(attributes);
    if (pressable && /(^|\s)title=/.test(attributes)) found.push(tag);
  }
  return found;
}

it("finds a native title on a pressable element, not on a component's own title prop", () => {
  expect(nativeTitles('<ActionIcon aria-label="x" title="Attach" />')).toEqual(["ActionIcon"]);
  expect(nativeTitles("<span onClick={go} title={`Go ${a > b}`}>x</span>")).toEqual(["span"]);
  expect(nativeTitles('<Alert title="Failed"><Button>Retry</Button></Alert>')).toEqual([]);
  expect(
    nativeTitles('<PageHeader title="Home" actions={<Button onClick={go}>Go</Button>} />'),
  ).toEqual([]);
  expect(nativeTitles('<Tooltip label="x"><ActionIcon aria-label="x" /></Tooltip>')).toEqual([]);
});

it("keeps native title attributes off pressable elements in the renderer", () => {
  const offenders = sourceFiles(UI)
    .map((file) => [relative(UI, file), nativeTitles(readFileSync(file, "utf8"))] as const)
    .filter(([, titles]) => titles.length > 0)
    .map(([file]) => file);
  expect(offenders.filter((file) => !LEGACY.has(file))).toEqual([]);
  // A cleaned-up file leaves the list, so the guard can't quietly loosen.
  expect([...LEGACY].filter((file) => !offenders.includes(file))).toEqual([]);
});
