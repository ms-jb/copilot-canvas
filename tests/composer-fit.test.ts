import { describe, expect, it } from "vite-plus/test";
import { composerFit, MEDIUM_MIN, WIDE_MIN } from "../ui/src/components/composerFit.ts";
import { settingsSummary } from "../ui/src/components/controls/labels.ts";
import type { SessionControls } from "../src/shared/contract.mts";

describe("composerFit", () => {
  it("picks the layout from the composer's width", () => {
    expect(composerFit(360)).toBe("narrow");
    expect(composerFit(MEDIUM_MIN - 1)).toBe("narrow");
    expect(composerFit(MEDIUM_MIN)).toBe("medium");
    expect(composerFit(698)).toBe("medium");
    expect(composerFit(WIDE_MIN - 1)).toBe("medium");
    expect(composerFit(WIDE_MIN)).toBe("wide");
    expect(composerFit(1000)).toBe("wide");
  });

  it("shows everything until the composer has been measured", () => {
    expect(composerFit(0)).toBe("wide");
  });
});

describe("settingsSummary", () => {
  const controls: SessionControls = {
    available: { mode: true, model: true, reasoningEffort: true, contextTier: false },
    mode: "interactive",
    modelId: "opus",
    reasoningEffort: "high",
    models: [{ id: "opus", name: "Claude Opus 5.5", defaultReasoningEffort: "medium" }],
  };
  const all = { mode: true, model: true, effort: true };

  it("names the model and effort", () => {
    expect(settingsSummary(controls, all)).toBe("Claude Opus 5.5 · High");
  });

  it("falls back to the model's default effort", () => {
    expect(settingsSummary({ ...controls, reasoningEffort: undefined }, all)).toBe(
      "Claude Opus 5.5 · Medium",
    );
  });

  it("leads with a mode that changes behavior, and stands alone with nothing else", () => {
    expect(settingsSummary({ ...controls, mode: "plan" }, all)).toBe(
      "Plan · Claude Opus 5.5 · High",
    );
    expect(settingsSummary(controls, { mode: true, model: false, effort: false })).toBe(
      "Interactive",
    );
  });
});
