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

export function tierLabel(tier: ContextTier): string {
  return tier === "long_context" ? "Long context" : "Standard context";
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
