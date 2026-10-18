import {
  ActionIcon,
  Alert,
  Button,
  Flex,
  Loader,
  Popover,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useState, type JSX } from "react";
import {
  SESSION_MODES,
  type ContextTier,
  type ControlChange,
  type SessionControls as Controls,
} from "../../shared";
import type { Connection } from "../../useConnection";
import { ChevronIcon, ControlPicker, type PickerOption } from "./ControlPicker";
import {
  MODE_LABELS,
  TIER_LABELS,
  activeModel,
  effectiveEffort,
  effortLabel,
  modelLabel,
  settingsSummary,
  tierLabel,
} from "./labels";
import styles from "./SessionControls.module.css";
import { useControlChange } from "./useControlChange";
import { useTouchSize } from "../touchSize";
import type { ComposerFit } from "../composerFit";
import { formatTokens } from "../../features/context/usage";

/** Shows a requested value while it is in flight or waiting for the turn to end. */
function displayed(controls: Controls, change: ControlChange | null): Controls {
  return change ? ({ ...controls, ...change } as Controls) : controls;
}

function modelOptions(controls: Controls): PickerOption[] {
  const options: PickerOption[] = controls.models.map((model) => {
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
    options.unshift({ value: controls.modelId, label: controls.modelId, disabled: true });
  }
  return options;
}

function effortOptions(controls: Controls): PickerOption[] {
  const model = activeModel(controls);
  return (model?.reasoningEfforts ?? []).map((effort) => ({
    value: effort,
    label: effortLabel(effort),
    hint: effort === model?.defaultReasoningEffort ? "Default for this model" : undefined,
  }));
}

function tierOptions(controls: Controls): PickerOption[] {
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

const MODE_OPTIONS: PickerOption[] = SESSION_MODES.map((mode) => ({
  value: mode,
  label: MODE_LABELS[mode].label,
  hint: MODE_LABELS[mode].hint,
}));

/**
 * Native session settings as a compact row of pills in the composer: mode, model, reasoning
 * effort and context window. Only controls the host verified are rendered, and options come only
 * from the session. A change the session applies after the current turn keeps a small spinner on
 * its pill until it lands; only a failed change is announced, as an alert.
 */
export function SessionControls({
  connection,
  fit,
}: {
  connection: Connection;
  fit: ComposerFit;
}): JSX.Element | null {
  const compact = fit !== "wide";
  const size = useTouchSize();
  const [opened, setOpened] = useState(false);
  const { pending, deferred, error, apply } = useControlChange(connection);
  const live = connection.view.controls;
  const requested = pending ?? deferred;
  const controls = displayed(live, requested);
  const { available } = live;
  const disabled =
    connection.phase !== "connected" || connection.context === null || pending !== null;
  const tierOffered = available.contextTier && (activeModel(live)?.contextTiers?.length ?? 0) > 1;
  const effort = effectiveEffort(controls);
  const tier = controls.contextTier ?? "default";
  const busy = (key: keyof Controls) => requested !== null && key in requested;
  const showMode = available.mode && controls.mode !== undefined;

  if (!showMode && !available.model && !available.reasoningEffort && !tierOffered) return null;

  const settings = (
    <Stack gap={4} miw={0}>
      {error && (
        <Alert variant="light" color="red" radius="sm" py={4} px="xs">
          <Text size="xs" c="red" lh={1.4}>
            {error}
          </Text>
        </Alert>
      )}
      <Flex
        gap={4}
        wrap="nowrap"
        // A compact popover stacks the pills; the composer keeps them in one row.
        direction={compact ? "column" : "row"}
        align={compact ? "stretch" : "center"}
        className={compact ? undefined : styles.row}
        role="group"
        aria-label="Session settings"
      >
        {showMode && controls.mode && (
          <ControlPicker
            withinPortal={!compact}
            block={compact}
            label="Mode"
            value={controls.mode}
            display={MODE_LABELS[controls.mode].label}
            options={MODE_OPTIONS}
            disabled={disabled}
            busy={busy("mode")}
            onChange={(value) => apply({ mode: value as (typeof SESSION_MODES)[number] })}
          />
        )}
        {available.model && (
          <ControlPicker
            withinPortal={!compact}
            block={compact}
            label="Model"
            value={controls.modelId}
            display={modelLabel(controls) ?? "Choose model"}
            options={modelOptions(live)}
            disabled={disabled}
            busy={busy("modelId")}
            searchLabel="Search models"
            onChange={(value) => apply({ modelId: value })}
          />
        )}
        {available.reasoningEffort && (
          <ControlPicker
            withinPortal={!compact}
            block={compact}
            label="Reasoning effort"
            value={effort}
            display={
              <>
                <Text span inherit c="var(--cc-text-faint)" mr={4}>
                  Effort
                </Text>
                {effort ? effortLabel(effort) : "Default"}
              </>
            }
            options={effortOptions(live)}
            disabled={disabled}
            busy={busy("reasoningEffort")}
            onChange={(value) => apply({ reasoningEffort: value })}
          />
        )}
        {tierOffered && (
          <ControlPicker
            withinPortal={!compact}
            block={compact}
            label="Context window"
            value={tier}
            display={
              <>
                <Text span inherit c="var(--cc-text-faint)" mr={4}>
                  Context
                </Text>
                {tierLabel(activeModel(controls), tier)}
              </>
            }
            options={tierOptions(live)}
            disabled={disabled}
            busy={busy("contextTier")}
            onChange={(value) => apply({ contextTier: value as ContextTier })}
          />
        )}
      </Flex>
    </Stack>
  );
  if (!compact) return settings;
  const label = error ? "Session settings: change failed" : "Session settings";
  const summary = settingsSummary(controls, {
    mode: showMode,
    model: available.model,
    effort: available.reasoningEffort,
  });
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="top-start"
      width={280}
      offset={8}
      trapFocus
      returnFocus
    >
      <Popover.Target>
        {fit === "medium" ? (
          <Button
            variant={opened ? "light" : "subtle"}
            color="gray"
            radius="xl"
            size="compact-sm"
            fw={400}
            maw="100%"
            miw={0}
            aria-label={`${label}: ${summary}`}
            aria-expanded={opened}
            title={summary}
            rightSection={requested ? <Loader size={10} color="currentColor" /> : <ChevronIcon />}
            onClick={() => setOpened((current) => !current)}
          >
            {summary}
          </Button>
        ) : (
          <Tooltip label={label} disabled={opened}>
            <ActionIcon
              size={size}
              radius="md"
              variant={opened ? "light" : "subtle"}
              color="gray"
              aria-label={label}
              aria-expanded={opened}
              onClick={() => setOpened((current) => !current)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </ActionIcon>
          </Tooltip>
        )}
      </Popover.Target>
      <Popover.Dropdown p={4}>{settings}</Popover.Dropdown>
    </Popover>
  );
}
