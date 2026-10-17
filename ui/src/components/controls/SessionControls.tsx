import { Popover } from "@mantine/core";
import { useState, type JSX } from "react";
import { SESSION_MODES, type ControlChange, type SessionControls as Controls } from "../../shared";
import type { Connection } from "../../useConnection";
import { ControlPicker, type PickerOption } from "./ControlPicker";
import { MODE_LABELS, activeModel, effectiveEffort, effortLabel, modelLabel } from "./labels";
import styles from "./SessionControls.module.css";
import { useControlChange } from "./useControlChange";
import { useLayoutMode } from "../../layout/useLayoutMode";

/** Shows a requested value while it is in flight or waiting for the turn to end. */
function displayed(controls: Controls, change: ControlChange | null): Controls {
  return change ? ({ ...controls, ...change } as Controls) : controls;
}

function modelOptions(controls: Controls): PickerOption[] {
  const options: PickerOption[] = controls.models.map((model) => ({
    value: model.id,
    label: model.name,
  }));
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

const MODE_OPTIONS: PickerOption[] = SESSION_MODES.map((mode) => ({
  value: mode,
  label: MODE_LABELS[mode].label,
  hint: MODE_LABELS[mode].hint,
}));

/**
 * Native session settings as a compact row of pills in the composer: mode, model, reasoning
 * effort and long context. Only controls the host verified are rendered, and options come only
 * from the session. A change the session applies after the current turn keeps a small spinner on
 * its pill until it lands; only a failed change is announced, as an alert.
 */
export function SessionControls({ connection }: { connection: Connection }): JSX.Element | null {
  const phone = useLayoutMode() === "phone";
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
    <div className={styles.composer}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.row} role="group" aria-label="Session settings">
        {showMode && controls.mode && (
          <ControlPicker
            withinPortal={!phone}
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
            withinPortal={!phone}
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
            withinPortal={!phone}
            label="Reasoning effort"
            value={effort}
            display={
              <>
                <span className={styles.prefix}>Effort</span>{" "}
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
          <button
            type="button"
            className={styles.pill}
            aria-pressed={tier === "long_context"}
            disabled={disabled}
            data-busy={busy("contextTier") || undefined}
            title="Use the model's long-context window"
            onClick={() =>
              apply({ contextTier: tier === "long_context" ? "default" : "long_context" })
            }
          >
            <span className={styles.triggerText}>Long context</span>
          </button>
        )}
      </div>
    </div>
  );
  if (!phone) return settings;
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
        <button
          type="button"
          className={styles.tune}
          aria-label={error ? "Session settings: change failed" : "Session settings"}
          title="Session settings"
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
        </button>
      </Popover.Target>
      <Popover.Dropdown className={`${styles.dropdown} ${styles.phoneSettings}`}>
        {settings}
      </Popover.Dropdown>
    </Popover>
  );
}
