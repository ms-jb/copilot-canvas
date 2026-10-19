import { ActionIcon, Tooltip, type ActionIconProps } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { cloneElement, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";
import { useTouchSize } from "./touchSize";

/** Tooltips are a mouse affordance: touch screens name a button by its `aria-label` alone. */
const CAN_HOVER = "(hover: hover)";

/**
 * The one tooltip every composer button uses (same side, offset and delay; the delay comes from the
 * theme). It passes `ref` and any other props on to the button inside, so a Popover or Menu target
 * still anchors to it and wires its events. `hidden` silences it while the button's own panel is
 * open.
 */
export function ComposerTooltip({
  label,
  hidden = false,
  children,
  ref,
  ...forwarded
}: {
  label: ReactNode;
  hidden?: boolean;
  children: ReactElement<Record<string, unknown>>;
  ref?: ComponentPropsWithRef<typeof Tooltip>["ref"];
  [prop: string]: unknown;
}) {
  const canHover = useMediaQuery(CAN_HOVER, false);
  const { className, ...rest } = forwarded;
  // Merge, so a Popover or Menu target adds its class to the button's own instead of replacing it.
  const merged = [children.props.className, className].filter(Boolean).join(" ") || undefined;
  return (
    <Tooltip ref={ref} label={label} position="top" offset={6} disabled={hidden || !canHover}>
      {cloneElement(children, { ...rest, className: merged })}
    </Tooltip>
  );
}

type ButtonProps = Omit<ComponentPropsWithRef<"button">, "title" | keyof ActionIconProps>;

interface ComposerIconButtonProps extends ButtonProps, Omit<ActionIconProps, "size" | "radius"> {
  /** The accessible name; also the tooltip unless `tip` says more. */
  label: string;
  tip?: ReactNode;
  /** Show the pressed or open look (the light variant) while the button's state is on. */
  active?: boolean;
  /** Hide the tooltip while a panel the button opened is showing. */
  hideTip?: boolean;
}

/**
 * Every icon button in the composer toolbar: one ActionIcon variant, radius and size (36px with a
 * mouse, 44px on touch), one tooltip, never a native `title`. A disabled button stays hoverable so
 * its tooltip can say why, and ignores clicks.
 */
export function ComposerIconButton({
  label,
  tip = label,
  active = false,
  hideTip = false,
  disabled = false,
  color = "gray",
  onClick,
  children,
  ref,
  ...rest
}: ComposerIconButtonProps) {
  const size = useTouchSize();
  return (
    <ComposerTooltip label={tip} hidden={hideTip}>
      <ActionIcon
        {...rest}
        ref={ref}
        size={size}
        radius="md"
        variant={active ? "light" : "subtle"}
        color={color}
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
      >
        {children}
      </ActionIcon>
    </ComposerTooltip>
  );
}
