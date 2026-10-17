import { Tooltip, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./IconButton.module.css";

interface IconButtonProps {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** For disclosure buttons: whether the controlled region is open. */
  expanded?: boolean;
  controls?: string;
}

/** Quiet square icon button for shell chrome; 44px touch target on coarse pointers. */
export function IconButton({ label, onClick, children, expanded, controls }: IconButtonProps) {
  return (
    <Tooltip label={label} withinPortal>
      <UnstyledButton
        className={classes.button}
        onClick={onClick}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={controls}
        data-active={expanded || undefined}
      >
        {children}
      </UnstyledButton>
    </Tooltip>
  );
}
