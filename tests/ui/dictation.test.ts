import { MantineProvider } from "@mantine/core";
import { expect, it, vi } from "vite-plus/test";
import {
  appendDictation,
  withInterim,
  editWithInterim,
  dictationReducer,
  IDLE_DICTATION,
  formatElapsed,
  togglesDictation,
} from "../../ui/src/features/dictation/model";
import { watchPageExit } from "../../ui/src/features/dictation/page-exit";
import { LIMITS } from "../../src/shared/contract.mts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MicButton } from "../../ui/src/features/dictation/MicButton";
import type { Dictation } from "../../ui/src/features/dictation/useDictation";

it("appends heard words once and within the prompt limit", () => {
  expect(appendDictation("hello", " there ")).toBe("hello there");
  expect(appendDictation("hello\n", "there")).toBe("hello\nthere");
  expect(appendDictation("hello", " ")).toBe("hello");
  expect(appendDictation("x".repeat(LIMITS.maxPromptChars), "hello")).toHaveLength(
    LIMITS.maxPromptChars,
  );
  expect(withInterim("hello", "there")).toEqual({ shown: "hello there", interim: " there" });
});

it("keeps interim words separate until a user edits them", () => {
  expect(editWithInterim("Hi there", " there")).toEqual({ draft: "Hi", absorbed: false });
  expect(editWithInterim("Hi friend", " there")).toEqual({ draft: "Hi friend", absorbed: true });
  expect(editWithInterim("Hello", "")).toEqual({ draft: "Hello", absorbed: false });
});

it("returns to idle on errors and ends and ignores late interim results", () => {
  let state = dictationReducer(IDLE_DICTATION, { type: "start", engine: "browser" });
  expect(state.phase).toBe("starting");
  state = dictationReducer(state, { type: "live", at: 10 });
  state = dictationReducer(state, { type: "interim", text: "hello" });
  expect(state).toMatchObject({ phase: "recording", startedAt: 10, interim: "hello" });
  expect(dictationReducer(state, { type: "ended" })).toEqual(IDLE_DICTATION);
  state = dictationReducer(state, { type: "failed", problem: "Microphone blocked" });
  expect(state.phase).toBe("idle");
  expect(dictationReducer(state, { type: "dismiss" })).toEqual(IDLE_DICTATION);
  expect(dictationReducer(IDLE_DICTATION, { type: "interim", text: "late" })).toBe(IDLE_DICTATION);
});

it("stops dictation on hidden pages and page exit and unregisters its listeners", () => {
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState,
  });
  const window = new EventTarget();
  const finish = vi.fn();
  const stopWatching = watchPageExit({ document, window }, finish);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(finish).not.toHaveBeenCalled();
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  expect(finish.mock.calls).toEqual([["hidden"], ["pagehide"]]);
  stopWatching();
  window.dispatchEvent(new Event("pagehide"));
  expect(finish).toHaveBeenCalledTimes(2);
});

it("formats elapsed microphone time", () => {
  expect(formatElapsed(7000)).toBe("0:07");
  expect(formatElapsed(102000)).toBe("1:42");
  expect(formatElapsed(-1)).toBe("0:00");
});

const dictation = (over: Partial<Dictation>): Dictation => ({
  state: IDLE_DICTATION,
  engine: "browser",
  unsupported: false,
  elapsedMs: 0,
  toggle: vi.fn(),
  dismiss: vi.fn(),
  finishForSend: () => "",
  absorbInterim: vi.fn(),
  ...over,
});
const mic = (over: Partial<Dictation>, disabled = false) =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(MicButton, { disabled, dictation: dictation(over) }),
    ),
  );

it("shows a disabled, named microphone when browser recognition is unavailable", () => {
  const html = mic({ engine: null, unsupported: true });
  expect(html).toContain("Dictation isn&#x27;t available in this browser");
  expect(html).toContain("disabled");
  expect(html).toContain('aria-keyshortcuts="Control+Space"');
});

it("offers the shortcut on the idle microphone and a red stop while recording", () => {
  expect(mic({})).toContain('aria-label="Dictate"');
  const recording = mic({
    state: { ...IDLE_DICTATION, phase: "recording", engine: "browser", startedAt: 0 },
    elapsedMs: 7000,
  });
  expect(recording).toContain('aria-label="Stop dictation"');
  expect(recording).toContain('aria-pressed="true"');
  expect(recording).toContain("0:07");
});

it("toggles dictation on Ctrl+Space alone", () => {
  const key = { code: "Space", shiftKey: false, ctrlKey: true, altKey: false, metaKey: false };
  expect(togglesDictation({ ...key, isComposing: false })).toBe(true);
  expect(togglesDictation({ ...key, isComposing: true })).toBe(false);
  expect(togglesDictation({ ...key, ctrlKey: false, isComposing: false })).toBe(false);
  expect(togglesDictation({ ...key, shiftKey: true, isComposing: false })).toBe(false);
  expect(togglesDictation({ ...key, metaKey: true, isComposing: false })).toBe(false);
  expect(togglesDictation({ ...key, code: "KeyM", isComposing: false })).toBe(false);
});

it("closes the draft with a full stop only for a later phrase", () => {
  const later = { sentenceBreak: true };
  expect(appendDictation("", "hello", later)).toBe("hello");
  expect(appendDictation("hello", "there", later)).toBe("hello. there");
  expect(appendDictation("Really?  ", "yes", later)).toBe("Really? yes");
  expect(appendDictation("a…", "b", later)).toBe("a… b");
  expect(appendDictation("  ", "b", later)).toBe("b");
  expect(appendDictation("hello", "there")).toBe("hello there");
  expect(appendDictation("x".repeat(LIMITS.maxPromptChars), "hi", later)).toHaveLength(
    LIMITS.maxPromptChars,
  );
});
