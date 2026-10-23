import { describe, expect, it } from "vite-plus/test";
import { composerFit, MEDIUM_MIN, WIDE_MIN } from "../ui/src/components/composerFit.ts";
import { settingsParts, settingsSummary } from "../ui/src/components/controls/labels.ts";
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
  const all = { model: true, effort: true };

  it("names the model and effort", () => {
    expect(settingsSummary(controls, all)).toBe("Claude Opus 5.5 · High");
  });

  it("keeps the effort separate from the model name, so a narrow chip can clip only the name", () => {
    expect(settingsParts(controls, all)).toEqual({ model: "Claude Opus 5.5", rest: ["High"] });
    expect(settingsParts(controls, { model: false, effort: true })).toEqual({
      model: null,
      rest: ["High"],
    });
  });

  it("falls back to the model's default effort", () => {
    expect(settingsSummary({ ...controls, reasoningEffort: undefined }, all)).toBe(
      "Claude Opus 5.5 · Medium",
    );
  });

  it("leaves the mode to its own chip and adds the context window only on a wide composer", () => {
    const tiered = {
      ...controls,
      mode: "plan" as const,
      models: [
        {
          id: "opus",
          name: "Claude Opus 5.5",
          contextTiers: ["default" as const, "long_context" as const],
          contextTokens: { default: 200_000 },
        },
      ],
    };
    const shown = { ...all, tier: true };
    expect(settingsSummary(tiered, shown)).toBe("Claude Opus 5.5 · High");
    expect(settingsSummary(tiered, shown, true)).toBe("Claude Opus 5.5 · High · 200k");
  });
});
