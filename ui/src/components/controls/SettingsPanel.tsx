import { Input, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { ContextTier, ControlChange, SessionControls as Controls } from "../../shared";
import { formatTokens } from "../../features/context/usage";
import { TIER_LABELS, activeModel, effectiveEffort, effortLabel } from "./labels";

/* On touch, fields and segments reach 44px like the theme's buttons, through Mantine's own variables. */
/** Above this many models the list gets a filter field (long model lists). */
const SEARCH_THRESHOLD = 8;
/** A row of buttons stays readable up to this many choices; more become a list. */
const SEGMENT_LIMIT = 4;

interface Choice {
  value: string;
  label: string;
  hint?: string;
}

export function modelChoices(controls: Controls): Choice[] {
  const choices: Choice[] = controls.models.map((model) => {
    const long = model.contextTokens?.long_context;
    return {
      value: model.id,
      label: model.name,
      hint: model.contextTiers?.includes("long_context")
        ? `Long context${long ? ` up to ${formatTokens(long)}` : ""}`
        : undefined,
    };
  });
  // The session may report a current model it does not list; show it, but it can't be re-picked.
  if (controls.modelId && !controls.models.some((model) => model.id === controls.modelId)) {
    choices.unshift({ value: controls.modelId, label: controls.modelId });
  }
  return choices;
}

export function effortChoices(controls: Controls): Choice[] {
  const model = activeModel(controls);
  return (model?.reasoningEfforts ?? []).map((effort) => ({
    value: effort,
    label: effortLabel(effort),
    hint: effort === model?.defaultReasoningEffort ? "Default for this model" : undefined,
  }));
}

export function tierChoices(controls: Controls): Choice[] {
  const model = activeModel(controls);
  return (model?.contextTiers ?? []).map((tier) => {
    const tokens = model?.contextTokens?.[tier];
    return {
      value: tier,
      label: TIER_LABELS[tier],
      hint: tokens ? `${formatTokens(tokens)} token window` : undefined,
    };
  });
}

/** One setting: its name, a row of buttons for the choices, and a line about the one in use. */
function ChoiceRow({
  label,
  choices,
  value,
  disabled,
  touch,
  onChange,
}: {
  label: string;
  choices: Choice[];
  value: string | undefined;
  disabled: boolean;
  touch: boolean;
  onChange: (value: string) => void;
}): ReactNode {
  const hint = choices.find((choice) => choice.value === value)?.hint;
  return (
    <Input.Wrapper
      label={label}
      labelElement="div"
      description={hint}
      inputWrapperOrder={["label", "input", "description"]}
    >
      <SegmentedControl
        fullWidth
        vars={touch ? () => ({ root: { "--sc-padding": "0.5rem 0.625rem" } }) : undefined}
        aria-label={label}
        data={choices.map(({ value: choice, label: text }) => ({ value: choice, label: text }))}
        value={value ?? ""}
        disabled={disabled}
        onChange={(next) => next !== value && onChange(next)}
      />
    </Input.Wrapper>
  );
}

/**
 * The session settings as one grouped panel (in a Popover on a mouse, a bottom Drawer on touch):
 * Model, Reasoning effort and Context window, each only when the host verified it (the mode has
 * its own chip). Values
 * apply as soon as they are picked; the panel stays open so related settings can be changed
 * together. Options come only from the session.
 */
export function SettingsPanel({
  controls,
  live,
  showModel,
  showEffort,
  showTier,
  disabled,
  touch,
  portal,
  onListOpen,
  apply,
}: {
  /** What to show: the live values with any requested change laid over them. */
  controls: Controls;
  live: Controls;
  showModel: boolean;
  showEffort: boolean;
  showTier: boolean;
  disabled: boolean;
  touch: boolean;
  /** Whether the model list may open in a portal (a Popover would treat clicks in it as outside). */
  portal: boolean;
  /** Tells the container whether a model or effort list is open, so Escape closes only the list. */
  onListOpen: (open: boolean) => void;
  apply: (change: ControlChange) => void;
}): ReactNode {
  const models = modelChoices(live);
  const hints = new Map(models.map((model) => [model.value, model.hint]));
  // On touch, fields and segments reach 44px through Mantine variables, like the theme's buttons.
  const touchField = touch ? { input: { "--input-height": "2.75rem" } } : undefined;
  const efforts = effortChoices(live);
  const effort = effectiveEffort(controls);
  return (
    <Stack gap="md" role="group" aria-label="Session settings">
      {showModel && (
        <Select
          label="Model"
          styles={touchField}
          data={models.map(({ value, label }) => ({
            value,
            label,
            disabled: !live.models.some((model) => model.id === value),
          }))}
          value={controls.modelId ?? null}
          placeholder="Choose model"
          disabled={disabled}
          allowDeselect={false}
          // A search field raises the on-screen keyboard; touch scrolls the list instead.
          searchable={!touch && models.length > SEARCH_THRESHOLD}
          nothingFoundMessage="No matches"
          maxDropdownHeight={220}
          comboboxProps={{ withinPortal: portal }}
          onDropdownOpen={() => onListOpen(true)}
          onDropdownClose={() => onListOpen(false)}
          renderOption={({ option }) => (
            <Stack gap={0} miw={0}>
              <Text size="sm" truncate>
                {option.label}
              </Text>
              {hints.get(option.value) && (
                <Text size="xs" c="dimmed">
                  {hints.get(option.value)}
                </Text>
              )}
            </Stack>
          )}
          onChange={(value) => value && value !== controls.modelId && apply({ modelId: value })}
        />
      )}
      {showEffort &&
        (efforts.length > SEGMENT_LIMIT ? (
          <Select
            label="Reasoning effort"
            styles={touchField}
            data={efforts.map(({ value, label }) => ({ value, label }))}
            value={effort ?? null}
            disabled={disabled}
            allowDeselect={false}
            comboboxProps={{ withinPortal: portal }}
            onDropdownOpen={() => onListOpen(true)}
            onDropdownClose={() => onListOpen(false)}
            onChange={(value) => value && value !== effort && apply({ reasoningEffort: value })}
          />
        ) : (
          <ChoiceRow
            label="Reasoning effort"
            choices={efforts}
            value={effort}
            disabled={disabled}
            touch={touch}
            onChange={(value) => apply({ reasoningEffort: value })}
          />
        ))}
      {showTier && (
        <ChoiceRow
          label="Context window"
          choices={tierChoices(live)}
          value={controls.contextTier ?? "default"}
          disabled={disabled}
          touch={touch}
          onChange={(value) => apply({ contextTier: value as ContextTier })}
        />
      )}
    </Stack>
  );
}
