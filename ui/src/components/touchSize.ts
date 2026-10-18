import { useMediaQuery } from "@mantine/hooks";

const TOUCH = "(max-width: 768px), (pointer: coarse)";

/** Composer icon buttons: 36px with a mouse, 44px on phones and touch screens. */
export function useTouchSize(): number {
  return useMediaQuery(TOUCH) ? 44 : 36;
}
