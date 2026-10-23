import { formatTokens } from "../../features/context/usage";
import type { ContextTier, ModelOption, SessionControls, SessionMode } from "../../shared";

export const MODE_LABELS: Readonly<Record<SessionMode, { label: string; hint: string }>> = {
  interactive: { label: "Interactive", hint: "Works with you turn by turn" },
  plan: { label: "Plan", hint: "Plans before making changes" },
  autopilot: { label: "Autopilot", hint: "Keeps working until the task is done" },
};

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function effortLabel(effort: string): string {
  const known = EFFORT_LABELS[effort];
  if (known) return known;
  const words = effort.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : effort;
}

export function activeModel(controls: SessionControls): ModelOption | undefined {
  return controls.modelId
    ? controls.models.find((model) => model.id === controls.modelId)
    : undefined;
}

export function modelLabel(controls: SessionControls, modelId = controls.modelId): string | null {
  if (!modelId) return null;
  return controls.models.find((model) => model.id === modelId)?.name ?? modelId;
}

/** The effort in use: the session's override, else the model's advertised default. */
export function effectiveEffort(controls: SessionControls): string | undefined {
  return controls.reasoningEffort ?? activeModel(controls)?.defaultReasoningEffort;
}

export const TIER_LABELS: Readonly<Record<ContextTier, string>> = {
  default: "Standard",
  long_context: "Long context",
};

/** The window size for a tier when the catalog publishes it, else the tier's name. */
export function tierLabel(model: ModelOption | undefined, tier: ContextTier): string {
  const tokens = model?.contextTokens?.[tier];
  return tokens ? formatTokens(tokens) : TIER_LABELS[tier];
}

/**
 * The settings control's text as parts, e.g. `["Claude Opus 5.5", "High"]`: the model, then the
 * effort in use, then the context window on a wide composer (`full`) when the model offers a
 * choice. The mode has its own chip. A part that isn't shown is left out.
 */
export function settingsParts(
  controls: SessionControls,
  shown: { model: boolean; effort: boolean; tier?: boolean },
  full = false,
): { model: string | null; rest: string[] } {
  const effort = shown.effort ? effectiveEffort(controls) : undefined;
  return {
    model: shown.model ? modelLabel(controls) : null,
    rest: [
      effort ? effortLabel(effort) : null,
      full && shown.tier
        ? tierLabel(activeModel(controls), controls.contextTier ?? "default")
        : null,
    ].filter((part): part is string => part !== null),
  };
}

/** The same parts joined, e.g. "Claude Opus 5.5 · High": the control's accessible name and tooltip. */
export function settingsSummary(
  controls: SessionControls,
  shown: { model: boolean; effort: boolean; tier?: boolean },
  full = false,
): string {
  const { model, rest } = settingsParts(controls, shown, full);
  return (model ? [model, ...rest] : rest).join(" · ");
}
