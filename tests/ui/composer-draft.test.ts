import { afterEach, expect, it, vi } from "vite-plus/test";
import { onSuggestedPrompt, suggestPrompt } from "../../ui/src/composerDraft";

afterEach(() => vi.unstubAllGlobals());

it("delivers a suggested QR request as a draft when chat mounts after navigation", () => {
  const location = { hash: "#/other" };
  vi.stubGlobal("window", { location });
  const text =
    "Make a QR code image for https://phone.example.test/ and post it here so I can scan it with my phone.";
  suggestPrompt(text);
  expect(location.hash).toBe("#/chat");
  const listener = vi.fn();
  const unsubscribe = onSuggestedPrompt(listener);
  expect(listener).toHaveBeenCalledExactlyOnceWith(text);
  unsubscribe();
  const laterListener = vi.fn();
  const unsubscribeLater = onSuggestedPrompt(laterListener);
  expect(laterListener).not.toHaveBeenCalled();
  unsubscribeLater();
});

it("delivers directly to a mounted composer without a network send", () => {
  vi.stubGlobal("window", { location: { hash: "#/chat" } });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const listener = vi.fn();
  const unsubscribe = onSuggestedPrompt(listener);
  suggestPrompt("Make a QR code image for https://phone.example.test/");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  unsubscribe();
});
