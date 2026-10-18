import {
  Button,
  CheckIcon,
  Combobox,
  Group,
  Loader,
  Stack,
  Text,
  useCombobox,
  type ButtonProps,
} from "@mantine/core";
import { useState, type ReactNode } from "react";
import { useTouchSize } from "../touchSize";
import styles from "./SessionControls.module.css";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * The look shared by every pill in the session settings row: muted text that brightens on hover.
 * `block` is the phone popover's full-width row.
 */
function usePillProps({ block }: { block?: boolean }) {
  const touch = useTouchSize() === 44;
  return {
    size: block ? "sm" : "compact-sm",
    h: block ? 44 : touch ? 36 : 28,
    radius: "xl",
    variant: "subtle",
    fw: 400,
    fullWidth: block,
    justify: block ? "space-between" : undefined,
    className: styles.pill,
    vars: () => ({
      root: {
        "--button-color": "var(--cc-text-muted)",
        "--button-bg": "transparent",
        "--button-bd": "1px solid transparent",
        "--button-hover": "var(--cc-surface-sunken)",
        "--button-hover-color": "var(--cc-text)",
      },
    }),
  } satisfies ButtonProps & { className: string };
}

// Above this many options the dropdown gets a filter field (long model lists).
const SEARCH_THRESHOLD = 8;

export function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A compact single-choice pill that opens a listbox. Options are exactly what the session reported; nothing is added here.
 */
export function ControlPicker(props: {
  /** Accessible name of the setting, e.g. "Model". */
  label: string;
  value: string | undefined;
  /** Text shown on the trigger. */
  display: ReactNode;
  options: PickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  busy?: boolean;
  searchLabel?: string;
  withinPortal?: boolean;
  /** Full-width with a 44px target, for the phone's settings popover. */
  block?: boolean;
}) {
  const { label, value, display, options, onChange, disabled, busy, block } = props;
  const pill = usePillProps({ block });
  const [search, setSearch] = useState("");
  const searchable = options.length > SEARCH_THRESHOLD;
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch("");
    },
    onDropdownOpen: () => {
      if (searchable) combobox.focusSearchInput();
      else combobox.updateSelectedOptionIndex("active");
    },
  });

  const query = search.trim().toLowerCase();
  const visible = query
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query),
      )
    : options;
  const current = options.find((option) => option.value === value);

  return (
    <Combobox
      withinPortal={props.withinPortal}
      store={combobox}
      position="top-start"
      width={280}
      offset={6}
      disabled={disabled}
      onOptionSubmit={(next) => {
        combobox.closeDropdown();
        if (next !== value) onChange(next);
      }}
    >
      <Combobox.Target targetType="button" withExpandedAttribute>
        <Button
          {...pill}
          disabled={disabled}
          data-busy={busy || undefined}
          rightSection={busy ? <Loader size={10} color="currentColor" /> : <ChevronIcon />}
          aria-label={`${label}: ${current?.label ?? "not set"}`}
          title={label}
          onClick={() => combobox.toggleDropdown()}
        >
          {display}
        </Button>
      </Combobox.Target>
      <Combobox.Dropdown>
        {searchable && (
          <Combobox.Search
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              combobox.updateSelectedOptionIndex();
            }}
            placeholder={props.searchLabel ?? `Search ${label.toLowerCase()}`}
            aria-label={props.searchLabel ?? `Search ${label.toLowerCase()}`}
          />
        )}
        <Combobox.Options
          mah={block ? "min(300px, 45dvh)" : 300}
          className={styles.options}
          aria-label={label}
        >
          {visible.length === 0 ? (
            <Combobox.Empty>No matches</Combobox.Empty>
          ) : (
            visible.map((option) => (
              <Combobox.Option
                key={option.value}
                value={option.value}
                active={option.value === value}
                disabled={option.disabled}
              >
                <Group gap="xs" wrap="nowrap">
                  <Stack gap={2} flex={1} miw={0}>
                    <Text size="sm" truncate>
                      {option.label}
                    </Text>
                    {option.hint && (
                      <Text size="xs" c="dimmed">
                        {option.hint}
                      </Text>
                    )}
                  </Stack>
                  {option.value === value && <CheckIcon size={12} color="var(--cc-accent)" />}
                </Group>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
