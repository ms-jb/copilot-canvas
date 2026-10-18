import { MantineProvider } from "@mantine/core";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { composerFit } from "../../ui/src/components/composerFit";
import { ComposerIconButton } from "../../ui/src/components/ComposerIconButton";
import { ModeChip } from "../../ui/src/components/controls/ModeChip";
import { MODE_COLORS, cyclesMode, nextMode } from "../../ui/src/components/controls/mode";
import {
  useSessionSettings,
  type SessionSettings,
} from "../../ui/src/components/controls/useSessionSettings";
import { SessionControls } from "../../ui/src/components/controls/SessionControls";
import {
  SettingsPanel,
  effortChoices,
  modelChoices,
  tierChoices,
} from "../../ui/src/components/controls/SettingsPanel";
import { theme } from "../../ui/src/theme";
import type { Connection } from "../../ui/src/useConnection";
import type { ModelOption, SessionControls as Controls } from "../../src/shared/contract.mts";

const render = (node: ReactNode) =>
  renderToStaticMarkup(createElement(MantineProvider, { theme }, node));

const OPUS: ModelOption = {
  id: "opus",
  name: "Claude Opus 5.5",
  reasoningEfforts: ["low", "medium", "high", "xhigh"],
  defaultReasoningEffort: "medium",
  contextTiers: ["default", "long_context"],
  contextTokens: { default: 200_000, long_context: 1_000_000 },
};

const CONTROLS: Controls = {
  available: { mode: true, model: true, reasoningEffort: true, contextTier: true },
  mode: "interactive",
  modelId: "opus",
  reasoningEffort: "high",
  contextTier: "default",
  models: [OPUS, { id: "small", name: "Model C (fast)" }],
};

const panel = (controls: Controls, props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) =>
  render(
    createElement(SettingsPanel, {
      controls,
      live: controls,
      showModel: true,
      showEffort: true,
      showTier: true,
      disabled: false,
      touch: false,
      portal: false,
      onListOpen: () => {},
      apply: () => {},
      ...props,
    }),
  );

const connection = (controls: Controls) =>
  ({
    phase: "connected",
    context: { sessionId: "s1" },
    view: { controls },
    markStale: () => {},
  }) as unknown as Connection;

it("groups the settings under their own labels, with the value in use selected", () => {
  const html = panel(CONTROLS);
  for (const label of ["Model", "Reasoning effort", "Context window"]) {
    expect(html).toContain(label);
  }
  expect(html).not.toMatch(/>Mode</);
  expect(html).toMatch(/checked=""[^>]*value="high"/);
  expect(html).toMatch(/checked=""[^>]*value="default"/);
  expect(html).toContain("200k token window");
  expect(html).toContain('value="Claude Opus 5.5"');
});

it("shows only the rows the session offers", () => {
  const html = panel(CONTROLS, { showTier: false });
  expect(html).not.toContain("Context window");
  expect(html).toContain("Reasoning effort");
});

it("turns a long effort list into a select instead of a cramped row of buttons", () => {
  const many = ["none", "minimal", "low", "medium", "high"];
  const controls = { ...CONTROLS, models: [{ ...OPUS, reasoningEfforts: many }] };
  const html = panel(controls);
  expect(html.match(/mantine-Select-input/g)).toHaveLength(2);
  expect(html.match(/mantine-SegmentedControl-root/g)).toHaveLength(1);
  expect(effortChoices(controls).map((choice) => choice.value)).toEqual(many);
});

it("disables the rows while offline", () => {
  expect(panel(CONTROLS, { disabled: true })).toMatch(/<input[^>]*disabled[^>]*value="low"/);
});

it("grows fields to 44px on touch through Mantine's variables", () => {
  expect(panel(CONTROLS, { touch: true })).toContain("--input-height:2.75rem");
  expect(panel(CONTROLS)).not.toContain("--input-height:2.75rem");
});

it("lists only what the session reports, adding an unlisted current model as a choice", () => {
  expect(modelChoices({ ...CONTROLS, modelId: "ghost" }).map((choice) => choice.value)).toEqual([
    "ghost",
    "opus",
    "small",
  ]);
  expect(modelChoices(CONTROLS)[0]?.hint).toBe("Long context up to 1M");
  expect(tierChoices(CONTROLS).map((choice) => choice.hint)).toEqual([
    "200k token window",
    "1M token window",
  ]);
  expect(effortChoices(CONTROLS).find((choice) => choice.value === "medium")?.hint).toBe(
    "Default for this model",
  );
});

const withSettings = (
  controls: Controls,
  show: (settings: SessionSettings) => ReactNode,
  phase = "connected",
) => {
  const conn = { ...connection(controls), phase } as Connection;
  return render(
    createElement(function Harness() {
      return show(useSessionSettings(conn));
    }),
  );
};

it("opens one settings control: an icon when narrow, the model and effort when medium", () => {
  const narrow = withSettings(CONTROLS, (settings) =>
    createElement(SessionControls, { settings, fit: "narrow" }),
  );
  expect(narrow).toContain('aria-label="Session settings: Claude Opus 5.5 · High"');
  expect(narrow).not.toContain(">Claude Opus 5.5");
  const medium = withSettings(CONTROLS, (settings) =>
    createElement(SessionControls, { settings, fit: "medium" }),
  );
  expect(medium).toContain('aria-label="Session settings: Claude Opus 5.5 · High"');
  expect(medium).toContain(">Claude Opus 5.5 · High<");
  expect(medium).not.toContain(" title=");
  expect(medium).toContain('aria-haspopup="dialog"');
  expect(medium).toContain('aria-expanded="false"');
});

it("renders no settings control when none is offered", () => {
  const none: Controls = {
    ...CONTROLS,
    available: { mode: false, model: false, reasoningEffort: false, contextTier: false },
  };
  const html = withSettings(none, (settings) =>
    createElement(SessionControls, { settings, fit: "wide" }),
  );
  expect(html).not.toContain("Session settings");
});

it("cycles Interactive, Plan, Autopilot and back, and knows nothing about other modes", () => {
  expect(nextMode("interactive")).toBe("plan");
  expect(nextMode("plan")).toBe("autopilot");
  expect(nextMode("autopilot")).toBe("interactive");
  expect(nextMode(undefined)).toBeNull();
  expect(nextMode("review")).toBeNull();
});

it("takes Shift+Tab alone: Tab, other chords and an open IME composition keep their meaning", () => {
  const key = {
    key: "Tab",
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
  };
  expect(cyclesMode(key)).toBe(true);
  expect(cyclesMode({ ...key, shiftKey: false })).toBe(false);
  expect(cyclesMode({ ...key, key: "Enter" })).toBe(false);
  for (const held of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    expect(cyclesMode({ ...key, ...held })).toBe(false);
  }
});

it("doesn't cycle offline or from a mode the host can't report", () => {
  let offline = true;
  withSettings(
    CONTROLS,
    (settings) => {
      offline = settings.cycleMode();
      return null;
    },
    "offline",
  );
  expect(offline).toBe(false);
  let unknown = true;
  withSettings({ ...CONTROLS, mode: undefined }, (settings) => {
    unknown = settings.cycleMode();
    return null;
  });
  expect(unknown).toBe(false);
});

it("shows Plan and Autopilot in words and Interactive as its shape alone, at every composer width", () => {
  expect(MODE_COLORS).toEqual({ interactive: "gray", plan: "blue", autopilot: "green" });
  for (const width of [360, 480, 600, 730, 1000]) {
    const fit = composerFit(width);
    for (const [mode, label, tint] of [
      ["interactive", "Interactive", "--mantine-color-gray"],
      ["plan", "Plan", "--mantine-color-blue"],
      ["autopilot", "Autopilot", "--mantine-color-green"],
    ] as const) {
      const html = withSettings({ ...CONTROLS, mode }, (settings) =>
        createElement(
          "div",
          { "data-fit": fit },
          createElement(ModeChip, { settings }),
          createElement(SessionControls, { settings, fit }),
        ),
      );
      expect(html).toContain(`aria-label="Mode: ${label}"`);
      // Interactive is the usual mode: no visible word, but the name, tooltip target and tint stay.
      if (mode === "interactive") expect(html).not.toContain(">Interactive<");
      else expect(html).toContain(`>${label}</span>`);
      expect(html).toContain("<svg");
      expect(html).toContain(`data-mode="${mode}"`);
      expect(html).toContain(tint);
    }
  }
});

it("shows no mode chip when the host can't report a mode", () => {
  const html = withSettings(
    { ...CONTROLS, available: { ...CONTROLS.available, mode: false } },
    (settings) => createElement(ModeChip, { settings }),
  );
  expect(html).not.toContain("Mode:");
});

it("gives every composer icon button the same look, a name and no native title", () => {
  const html = render(createElement(ComposerIconButton, { label: "Dictate", disabled: true }, "x"));
  expect(html).toContain('aria-label="Dictate"');
  expect(html).toContain('data-variant="subtle"');
  expect(html).not.toContain(" title=");
  // Disabled stays hoverable (so the tooltip can say why) and is announced, not natively disabled.
  expect(html).toContain('aria-disabled="true"');
  expect(html).not.toMatch(/<button[^>]*\sdisabled/);
});
