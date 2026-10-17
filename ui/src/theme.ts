import { createTheme, type CSSVariablesResolver } from "@mantine/core";
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

export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
});

// Palette fallbacks used when the host does not inject its CSS variables (e.g. in a plain browser).
const fallback = {
  light: {
    background: "#ffffff",
    muted: "#f6f8fa",
    border: "#d1d9e0",
    text: "#1f2328",
    textMuted: "#59636e",
    accent: "#0969da",
    accentMuted: "#ddf4ff",
    danger: "#d1242f",
    dangerMuted: "#ffebe9",
    success: "#1a7f37",
    attention: "#9a6700",
  },
  dark: {
    background: "#0d1117",
    muted: "#151b23",
    border: "#3d444d",
    text: "#f0f6fc",
    textMuted: "#9198a1",
    accent: "#4493f8",
    accentMuted: "#388bfd26",
    danger: "#f85149",
    dangerMuted: "#f851491a",
    success: "#3fb950",
    attention: "#d29922",
  },
};

function mapHostVariables(palette: typeof fallback.light): Record<string, string> {
  return {
    "--mantine-color-body": `var(--background-color-default, ${palette.background})`,
    "--mantine-color-text": `var(--text-color-default, ${palette.text})`,
    "--mantine-color-dimmed": `var(--text-color-muted, ${palette.textMuted})`,
    "--mantine-color-placeholder": `var(--text-color-muted, ${palette.textMuted})`,
    "--mantine-color-default": `var(--background-color-default, ${palette.background})`,
    "--mantine-color-default-hover": `var(--background-color-muted, ${palette.muted})`,
    "--mantine-color-default-color": `var(--text-color-default, ${palette.text})`,
    "--mantine-color-default-border": `var(--border-color-default, ${palette.border})`,
    "--mantine-color-anchor": `var(--fgColor-accent, ${palette.accent})`,
    "--mantine-color-error": `var(--fgColor-danger, ${palette.danger})`,
    "--mantine-primary-color-filled": `var(--fgColor-accent, ${palette.accent})`,
    "--mantine-primary-color-filled-hover": `var(--fgColor-accent, ${palette.accent})`,
    "--mantine-primary-color-light": `var(--bgColor-accent-muted, ${palette.accentMuted})`,
    "--mantine-primary-color-light-hover": `var(--bgColor-accent-muted, ${palette.accentMuted})`,
    "--mantine-primary-color-light-color": `var(--fgColor-accent, ${palette.accent})`,
    // Panel-specific tokens consumed by styles.css.
    "--panel-bg-muted": `var(--background-color-muted, ${palette.muted})`,
    "--panel-border": `var(--border-color-default, ${palette.border})`,
    "--panel-accent": `var(--fgColor-accent, ${palette.accent})`,
    "--panel-accent-muted": `var(--bgColor-accent-muted, ${palette.accentMuted})`,
    "--panel-danger": `var(--fgColor-danger, ${palette.danger})`,
    "--panel-danger-muted": `var(--bgColor-danger-muted, ${palette.dangerMuted})`,
    "--panel-success": `var(--fgColor-success, ${palette.success})`,
    "--panel-attention": `var(--fgColor-attention, ${palette.attention})`,
    "--panel-focus": `var(--color-focus-outline, var(--fgColor-accent, ${palette.accent}))`,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: mapHostVariables(fallback.light),
  dark: mapHostVariables(fallback.dark),
});
