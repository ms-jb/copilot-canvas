import { Combobox, Loader, useCombobox } from "@mantine/core";
import { useState, type ReactNode } from "react";
import styles from "./SessionControls.module.css";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

// Above this many options the dropdown gets a filter field (long model lists).
const SEARCH_THRESHOLD = 8;

function ChevronIcon() {
  return (
    <svg className={styles.chevron} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
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

function CheckIcon() {
  return (
    <svg className={styles.check} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
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
}) {
  const { label, value, display, options, onChange, disabled, busy } = props;
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
      store={combobox}
      position="top-start"
      width={280}
      offset={6}
      disabled={disabled}
      classNames={{ dropdown: styles.dropdown }}
      onOptionSubmit={(next) => {
        combobox.closeDropdown();
        if (next !== value) onChange(next);
      }}
    >
      <Combobox.Target targetType="button" withExpandedAttribute>
        <button
          type="button"
          className={styles.pill}
          disabled={disabled}
          data-busy={busy || undefined}
          aria-label={`${label}: ${current?.label ?? "not set"}`}
          title={label}
          onClick={() => combobox.toggleDropdown()}
        >
          <span className={styles.triggerText}>{display}</span>
          {busy ? <Loader size={10} className={styles.spinner} /> : <ChevronIcon />}
        </button>
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
            classNames={{ input: styles.search }}
          />
        )}
        <Combobox.Options className={styles.options} aria-label={label}>
          {visible.length === 0 ? (
            <Combobox.Empty className={styles.empty}>No matches</Combobox.Empty>
          ) : (
            visible.map((option) => (
              <Combobox.Option
                key={option.value}
                value={option.value}
                active={option.value === value}
                disabled={option.disabled}
                className={styles.option}
              >
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.hint && <span className={styles.optionHint}>{option.hint}</span>}
                </span>
                {option.value === value && <CheckIcon />}
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
