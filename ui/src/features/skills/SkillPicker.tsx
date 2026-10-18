import { Combobox, Group, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { ComposerIconButton } from "../../components/ComposerIconButton";
import type { SkillPickerState } from "./useSkillPicker";
import styles from "./Skills.module.css";

/** Anchors the skill list above `children` (the composer card) and shows it while `/` is typed. */
export function SkillPicker({
  picker,
  children,
}: {
  picker: SkillPickerState;
  children: ReactElement;
}) {
  return (
    <Combobox
      store={picker.combobox}
      onOptionSubmit={picker.pick}
      position="top-start"
      width="target"
      offset={6}
      transitionProps={{ duration: 0 }}
    >
      <Combobox.DropdownTarget>{children}</Combobox.DropdownTarget>
      <Combobox.Dropdown className={styles.dropdown}>
        <Combobox.Options aria-label="Skills" className={styles.options}>
          {picker.matches.length === 0 ? (
            <Combobox.Empty>No matching skills</Combobox.Empty>
          ) : (
            picker.matches.map((skill) => (
              <Combobox.Option key={skill.name} value={skill.name} className={styles.option}>
                <Group gap={6} wrap="nowrap" miw={0}>
                  <Text size="sm" fw={600} truncate>
                    /{skill.name}
                  </Text>
                  {skill.hint && (
                    <Text size="xs" c="dimmed" truncate>
                      {skill.hint}
                    </Text>
                  )}
                </Group>
                {skill.description && (
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {skill.description}
                  </Text>
                )}
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

/** Starts a slash command from the footer, for touch screens without a handy `/` key. */
export function SkillButton({ picker, disabled }: { picker: SkillPickerState; disabled: boolean }) {
  if (!picker.available) return null;
  return (
    <ComposerIconButton
      label="Use a skill"
      tip="Use a skill (type /)"
      disabled={disabled}
      // Keep the field focused so the soft keyboard stays up.
      onMouseDown={(event) => event.preventDefault()}
      onClick={picker.start}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M15 4 9 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </ComposerIconButton>
  );
}
