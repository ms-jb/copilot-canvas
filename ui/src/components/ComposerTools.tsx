import { ActionIcon, FileButton, Menu, Tooltip } from "@mantine/core";
import { useRef, type ReactNode } from "react";
import { ATTACHMENT_ACCEPT } from "../features/attachments/files";
import type { useAttachments } from "../features/attachments/useAttachments";
import { SkillButton } from "../features/skills/SkillPicker";
import type { SkillPickerState } from "../features/skills/useSkillPicker";
import type { ComposerFit } from "./composerFit";
import { useTouchSize } from "./touchSize";

const PaperclipIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12 5v14M5 12h14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The composer's left cluster: attach, the mic and the skill button. When the composer is narrow,
 * attach and skills fold into a "+" menu and the mic stays; `mic` is rendered here to keep the order.
 */
export function ComposerTools({
  fit,
  attachments,
  attachmentsDisabled,
  skills,
  skillsDisabled,
  mic,
}: {
  fit: ComposerFit;
  attachments: ReturnType<typeof useAttachments>;
  attachmentsDisabled: boolean;
  skills: SkillPickerState;
  skillsDisabled: boolean;
  mic: ReactNode;
}) {
  const size = useTouchSize();
  const resetPicker = useRef<() => void>(null);
  const attachLabel = attachments.reading ? "Reading attachments" : "Attach files";
  const folded = fit === "narrow";

  return (
    <>
      {/* One FileButton for both layouts: its input must outlive the menu that opens it. */}
      <FileButton
        multiple
        accept={ATTACHMENT_ACCEPT}
        disabled={attachmentsDisabled}
        resetRef={resetPicker}
        onChange={(files) => {
          resetPicker.current?.();
          if (!attachmentsDisabled) void attachments.add(files);
        }}
      >
        {(props) =>
          folded ? (
            <Menu position="top-start" offset={8} returnFocus={false} withinPortal={false}>
              <Menu.Target>
                <ActionIcon
                  size={size}
                  radius="md"
                  variant="subtle"
                  color="gray"
                  loading={attachments.reading}
                  loaderProps={{ size: 16 }}
                  aria-label="Add to message"
                >
                  <PlusIcon />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<PaperclipIcon />}
                  disabled={attachmentsDisabled}
                  onClick={props.onClick}
                >
                  {attachLabel}
                </Menu.Item>
                {skills.available && (
                  <Menu.Item
                    leftSection={<SlashGlyph />}
                    disabled={skillsDisabled}
                    onClick={skills.start}
                  >
                    Use a skill
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          ) : (
            <Tooltip label="Attach images, PDF or text files">
              <ActionIcon
                {...props}
                size={size}
                radius="md"
                variant="subtle"
                color="gray"
                disabled={attachmentsDisabled}
                loading={attachments.reading}
                loaderProps={{ size: 16 }}
                aria-label={attachLabel}
              >
                <PaperclipIcon />
              </ActionIcon>
            </Tooltip>
          )
        }
      </FileButton>
      {mic}
      {!folded && <SkillButton picker={skills} size={size} disabled={skillsDisabled} />}
    </>
  );
}

const SlashGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M15 4 9 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);
