import { Button, Drawer, Loader, Popover } from "@mantine/core";
import { useEffect, useState, type JSX } from "react";
import type { ComposerFit } from "../composerFit";
import { ComposerIconButton, ComposerTooltip } from "../ComposerIconButton";
import { useTouchSize } from "../touchSize";
import { activeModel, settingsParts, settingsSummary } from "./labels";
import { SettingsPanel } from "./SettingsPanel";
import type { SessionSettings } from "./useSessionSettings";
import styles from "./SessionControls.module.css";

const SlidersIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The composer's native session settings: one control that shows the model and effort in use and
 * opens a grouped panel for model, reasoning effort and context window (an icon on a narrow
 * composer). Only controls the host verified are offered, and options come only from the session. A
 * change the session applies after the current turn keeps a spinner on the control until it lands;
 * a failed change is announced by the composer. The mode has its own chip (`ModeChip`).
 */
export function SessionControls({
  settings,
  fit,
}: {
  settings: SessionSettings;
  fit: ComposerFit;
}): JSX.Element | null {
  const size = useTouchSize();
  const touch = size === 44;
  const [opened, setOpened] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const { live, controls, requested, disabled, apply } = settings;
  useEffect(() => {
    if (!opened) setListOpen(false);
  }, [opened]);
  const { available } = live;
  const showTier = available.contextTier && (activeModel(live)?.contextTiers?.length ?? 0) > 1;
  const showModel = available.model;
  const showEffort = available.reasoningEffort;

  if (!showModel && !showEffort && !showTier) return null;

  const shown = { model: showModel, effort: showEffort, tier: showTier };
  const summary = settingsSummary(controls, shown, fit === "wide");
  const { model, rest } = settingsParts(controls, shown, fit === "wide");
  const toggle = () => setOpened((current) => !current);
  const trigger =
    fit === "narrow" ? (
      <ComposerIconButton
        label={`Session settings: ${summary}`}
        tip="Session settings"
        active={opened}
        hideTip={opened}
        aria-haspopup="dialog"
        aria-expanded={opened}
        onClick={toggle}
      >
        <SlidersIcon size={20} />
      </ComposerIconButton>
    ) : (
      <ComposerTooltip label={`Session settings: ${summary}`} hidden={opened}>
        <Button
          variant={opened ? "light" : "subtle"}
          color="gray"
          radius="md"
          size="compact-sm"
          h={size}
          px="xs"
          fw={400}
          maw="100%"
          miw={0}
          classNames={{ root: styles.chip, inner: styles.inner, label: styles.label }}
          leftSection={
            requested && !("mode" in requested) ? (
              <Loader size={14} color="currentColor" />
            ) : (
              <SlidersIcon size={16} />
            )
          }
          aria-label={`Session settings: ${summary}`}
          aria-haspopup="dialog"
          aria-expanded={opened}
          onClick={toggle}
        >
          {model ? (
            <>
              <span className={styles.model}>{model}</span>
              <span className={styles.rest}>{rest.map((part) => ` · ${part}`).join("")}</span>
            </>
          ) : (
            <span className={styles.rest}>{rest.join(" · ")}</span>
          )}
        </Button>
      </ComposerTooltip>
    );
  const panel = (
    <SettingsPanel
      controls={controls}
      live={live}
      showModel={showModel}
      showEffort={showEffort}
      showTier={showTier}
      disabled={disabled}
      touch={touch}
      portal={touch}
      onListOpen={setListOpen}
      apply={apply}
    />
  );

  // A touch screen gets a bottom sheet: it stays clear of the on-screen keyboard and the thumb.
  if (touch) {
    return (
      <>
        {trigger}
        <Drawer
          opened={opened}
          onClose={() => setOpened(false)}
          closeOnEscape={!listOpen}
          position="bottom"
          radius="md"
          // A bottom drawer is a fixed height by default; this sheet is as tall as its settings.
          styles={{
            content: { height: "auto", maxHeight: "85dvh" },
            body: {
              paddingBottom: "calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom))",
            },
          }}
          title="Session settings"
        >
          {panel}
        </Drawer>
      </>
    );
  }
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      closeOnEscape={!listOpen}
      position="top-start"
      width={340}
      offset={8}
      shadow="md"
      trapFocus
      returnFocus
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown maw="calc(100vw - 16px)">{panel}</Popover.Dropdown>
    </Popover>
  );
}
