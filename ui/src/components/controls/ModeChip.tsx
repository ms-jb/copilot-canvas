import { Button, CheckIcon, Loader, Menu, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SESSION_MODES, type SessionMode } from "../../shared";
import { ComposerTooltip } from "../ComposerIconButton";
import { useTouchSize } from "../touchSize";
import { MODE_LABELS } from "./labels";
import { MODE_COLORS } from "./mode";
import type { SessionSettings } from "./useSessionSettings";

const Glyph = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </g>
  </svg>
);

// A shape per mode, so the mode never depends on its color.
const MODE_ICONS: Record<SessionMode, ReactNode> = {
  interactive: (
    <Glyph>
      <path d="M5 6h14v9H10l-4 4v-4H5z" />
    </Glyph>
  ),
  plan: (
    <Glyph>
      <path d="m4 7 1.5 1.5L8 6M4 17l1.5 1.5L8 16M11 7h9M11 17h9M11 12h9" />
    </Glyph>
  ),
  autopilot: (
    <Glyph>
      <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
    </Glyph>
  ),
};

/**
 * The session mode, in the composer at every width: a shape for each mode and, for Plan and
 * Autopilot, its name, tinted blue and green. Interactive, the usual mode, shows only its shape
 * (the name stays in the accessible name and the menu). Pressing it lists the three modes
 * (Alt+M in the composer moves to the next one). Renders nothing when the host can't report a mode.
 */
export function ModeChip({
  settings,
  compact = false,
}: {
  settings: SessionSettings;
  /** A narrow composer: the word alone, so both names fit beside the other buttons. */
  compact?: boolean;
}) {
  const { mode, requested, disabled, apply } = settings;
  const size = useTouchSize();
  const [opened, setOpened] = useState(false);
  const spoken = useRef(mode);
  const [announcement, setAnnouncement] = useState("");
  // A change from the keyboard shortcut has no focus change to hear, so say the new mode once.
  useEffect(() => {
    if (mode === spoken.current) return;
    spoken.current = mode;
    if (mode) setAnnouncement(`Mode: ${MODE_LABELS[mode].label}`);
  }, [mode]);
  if (!mode) return null;

  const { label } = MODE_LABELS[mode];
  const color = MODE_COLORS[mode];
  const iconOnly = mode === "interactive";
  return (
    <>
      <Menu
        opened={opened}
        onChange={setOpened}
        position="top-start"
        offset={8}
        width={260}
        shadow="md"
        disabled={disabled}
      >
        <Menu.Target>
          <ComposerTooltip label="Switch mode (Alt+M)" hidden={opened}>
            <Button
              variant={mode === "interactive" ? "subtle" : "light"}
              color={color}
              radius="md"
              size="compact-sm"
              h={size}
              px={compact && !iconOnly ? 6 : "xs"}
              miw={iconOnly ? size : undefined}
              styles={iconOnly ? { section: { marginInlineEnd: 0 } } : undefined}
              fw={500}
              flex="none"
              data-mode={mode}
              leftSection={
                requested && "mode" in requested ? (
                  <Loader size={14} color="currentColor" />
                ) : compact && !iconOnly ? undefined : (
                  MODE_ICONS[mode]
                )
              }
              aria-label={`Mode: ${label}`}
              aria-haspopup="menu"
              aria-keyshortcuts="Alt+M"
              disabled={disabled}
            >
              {iconOnly ? null : label}
            </Button>
          </ComposerTooltip>
        </Menu.Target>
        <Menu.Dropdown>
          {SESSION_MODES.map((option) => (
            <Menu.Item
              key={option}
              color={MODE_COLORS[option] === "gray" ? undefined : MODE_COLORS[option]}
              leftSection={MODE_ICONS[option]}
              rightSection={option === mode ? <CheckIcon size={12} /> : null}
              mih={size}
              onClick={() => option !== mode && apply({ mode: option })}
            >
              <Stack gap={0}>
                <Text size="sm" fw={option === mode ? 600 : 400}>
                  {MODE_LABELS[option].label}
                  {option === mode && <VisuallyHidden> (current)</VisuallyHidden>}
                </Text>
                <Text size="xs" c="dimmed">
                  {MODE_LABELS[option].hint}
                </Text>
              </Stack>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <VisuallyHidden role="status" aria-live="polite">
        {announcement}
      </VisuallyHidden>
    </>
  );
}
