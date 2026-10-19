import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  createCodeCopyController,
  availableClipboard,
  highlightCode,
  parseCodeFenceLanguage,
} from "../../ui/src/features/markdown/code-blocks";

afterEach(() => vi.useRealTimers());

it("parses language labels from fence info and maps known aliases", () => {
  expect(parseCodeFenceLanguage("TS title=demo.ts")).toEqual({
    label: "ts",
    language: "typescript",
  });
  expect(parseCodeFenceLanguage("bash")).toEqual({ label: "bash", language: "bash" });
  expect(parseCodeFenceLanguage("brainfuck")).toEqual({ label: "brainfuck", language: null });
  expect(parseCodeFenceLanguage("")).toEqual({ label: null, language: null });
});

it("copies raw code text and clears copied state after the timeout", async () => {
  vi.useFakeTimers();
  const copied: boolean[] = [];
  const writeText = vi.fn(async () => {});
  const controller = createCodeCopyController({
    clipboard: { writeText },
    onCopied: (value) => copied.push(value),
    delayMs: 25,
  });
  const source = "const x = 1;\nconsole.log(x);\n";
  await controller.copy(source);
  expect(writeText).toHaveBeenCalledWith(source);
  expect(copied).toEqual([true]);
  vi.advanceTimersByTime(25);
  expect(copied).toEqual([true, false]);
});

it("falls back cleanly when clipboard access is unavailable", async () => {
  const copied: boolean[] = [];
  const controller = createCodeCopyController({
    clipboard: null,
    onCopied: (value) => copied.push(value),
  });
  await expect(controller.copy("const x = 1;")).resolves.toBe(false);
  expect(copied).toEqual([]);
});

it("preserves the native clipboard receiver and handles refused access", async () => {
  const clipboard = {
    async writeText(this: object, _value: string) {
      expect(this).toBe(clipboard);
    },
  };
  await availableClipboard(clipboard)!.writeText("code");
  const copied = vi.fn();
  const controller = createCodeCopyController({
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    onCopied: copied,
  });
  expect(await controller.copy("code")).toBe(false);
  expect(copied).toHaveBeenCalledWith(false);
});

it("escapes highlighted code and never loads unknown or inherited language names", async () => {
  for (const name of ["constructor", "__proto__", "<svg>"]) {
    expect(parseCodeFenceLanguage(name).language).toBeNull();
  }
  const html = await highlightCode('<script>alert("x")</script>', "xml");
  expect(html).toContain("&lt;");
  expect(html).not.toContain("<script>");
  expect(await highlightCode("plain", null)).toBeNull();
});
