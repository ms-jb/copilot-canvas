import {
  createTheme,
  defaultVariantColorsResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from "@mantine/core";
import { useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Live `prefers-color-scheme: dark`; the host drives the preference, there is no picker. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

// Mantine palettes point at the design tokens in styles.css, so `color="red"` or the primary
// color follow the host theme instead of Mantine's built-in hues. Mantine derives tints from
// `var(...)` colors with color-mix, so one value per palette is enough.
const tokenPalette = (token: string): MantineColorsTuple =>
  Array.from({ length: 10 }, () => `var(${token})`) as unknown as MantineColorsTuple;

const accent = tokenPalette("--cc-accent");

// Dark-scheme Mantine surfaces (inputs, menus, hovers) read the `dark` palette.
const dark: MantineColorsTuple = [
  "var(--cc-text)",
  "var(--cc-text-muted)",
  "var(--cc-text-muted)",
  "var(--cc-text-faint)",
  "var(--cc-border-strong)",
  "var(--cc-border)",
  "var(--cc-surface-raised)",
  "var(--cc-bg)",
  "var(--cc-surface-sunken)",
  "var(--cc-surface-sunken)",
];

const ACCENT_COLORS = new Set(["accent", "blue"]);

// Filled accent buttons use the accent's contrast ink (dark on the bright dark-theme accent).
const variantColorResolver: VariantColorsResolver = (input) => {
  const result = defaultVariantColorsResolver(input);
  if (input.variant === "filled" && (!input.color || ACCENT_COLORS.has(input.color))) {
    return { ...result, color: "var(--cc-accent-contrast)" };
  }
  return result;
};

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: 6,
  colors: {
    accent,
    blue: accent,
    red: tokenPalette("--cc-danger"),
    green: tokenPalette("--cc-success"),
    yellow: tokenPalette("--cc-warning"),
    orange: tokenPalette("--cc-warning"),
    dark,
  },
  variantColorResolver,
  fontFamily: "var(--cc-font-sans)",
  fontFamilyMonospace: "var(--cc-font-mono)",
  headings: { fontFamily: "var(--cc-font-sans)", fontWeight: "600" },
  fontSizes: {
    xs: "var(--cc-text-xs)",
    sm: "var(--cc-text-sm)",
    md: "var(--cc-text-md)",
    lg: "var(--cc-text-lg)",
    xl: "18px",
  },
  radius: {
    xs: "4px",
    sm: "var(--cc-radius-sm)",
    md: "var(--cc-radius-md)",
    lg: "var(--cc-radius-lg)",
    xl: "20px",
  },
  defaultRadius: "sm",
  spacing: {
    xs: "var(--cc-space-2)",
    sm: "var(--cc-space-3)",
    md: "var(--cc-space-4)",
    lg: "var(--cc-space-5)",
    xl: "var(--cc-space-6)",
  },
  shadows: {
    xs: "var(--cc-shadow-sm)",
    sm: "var(--cc-shadow-sm)",
    md: "var(--cc-shadow-md)",
    lg: "var(--cc-shadow-md)",
    xl: "var(--cc-shadow-md)",
  },
  cursorType: "pointer",
  focusRing: "auto",
  respectReducedMotion: true,
  components: {
    Tooltip: { defaultProps: { openDelay: 400, transitionProps: { duration: 120 } } },
    Drawer: {
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.32 },
        transitionProps: { duration: 200 },
      },
    },
    Modal: {
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.32 },
        transitionProps: { duration: 180 },
      },
    },
  },
});

const accentStates = (prefix: string): Record<string, string> => ({
  [`${prefix}-filled-hover`]: "color-mix(in srgb, var(--cc-accent) 86%, var(--cc-text))",
  [`${prefix}-light`]: "var(--cc-accent-soft)",
  [`${prefix}-light-hover`]: "color-mix(in srgb, var(--cc-accent) 22%, transparent)",
  [`${prefix}-light-color`]: "var(--cc-accent)",
});

// Mantine's semantic variables, redirected to the tokens. Applied to both schemes because the
// tokens themselves already switch with `prefers-color-scheme`.
const semanticVariables: Record<string, string> = {
  ...accentStates("--mantine-primary-color"),
  ...accentStates("--mantine-color-accent"),
  ...accentStates("--mantine-color-blue"),
  "--mantine-color-body": "var(--cc-bg)",
  "--mantine-color-text": "var(--cc-text)",
  "--mantine-color-bright": "var(--cc-text)",
  "--mantine-color-dimmed": "var(--cc-text-muted)",
  "--mantine-color-placeholder": "var(--cc-text-faint)",
  "--mantine-color-anchor": "var(--cc-accent)",
  "--mantine-color-error": "var(--cc-danger)",
  "--mantine-color-default": "var(--cc-surface-raised)",
  "--mantine-color-default-hover":
    "color-mix(in srgb, var(--cc-text) 6%, var(--cc-surface-raised))",
  "--mantine-color-default-color": "var(--cc-text)",
  "--mantine-color-default-border": "var(--cc-border)",
  "--mantine-color-disabled": "var(--cc-surface-sunken)",
  "--mantine-color-disabled-color": "var(--cc-text-faint)",
  "--mantine-color-disabled-border": "var(--cc-border)",
  "--mantine-primary-color-contrast": "var(--cc-accent-contrast)",
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: semanticVariables,
  dark: semanticVariables,
});
