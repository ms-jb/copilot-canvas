import { useMediaQuery } from "@mantine/hooks";

export type LayoutMode = "phone" | "tablet" | "desktop";

/** At or below this width the shell is a single column; sidebar and aside become drawers. */
export const PHONE_MAX_WIDTH = 768;
/** At or below this width the aside becomes a drawer, hidden until toggled. */
export const TABLET_MAX_WIDTH = 1100;

const NOW = { getInitialValueInEffect: false };

export function useLayoutMode(): LayoutMode {
  const phone = useMediaQuery(`(max-width: ${PHONE_MAX_WIDTH}px)`, false, NOW);
  const tablet = useMediaQuery(`(max-width: ${TABLET_MAX_WIDTH}px)`, false, NOW);
  return phone ? "phone" : tablet ? "tablet" : "desktop";
}
