---
name: theme-and-identity
description: "Use for 'rename my assistant', 'open this view first', 'change the accent or spacing', or 'change the phone app name or icon'. Personalize existing configuration and theme tokens."
---

# Theme and identity

Read `AGENTS.md` and `.github/skills/customization-workflow/SKILL.md`.
Keep this change to identity and appearance. Use `add-view-or-panel` when the
request also needs a new destination or panel.

## 1. Change the right identity

- Read `template.config.json` before editing it. Change `assistantName` for the
  assistant and canvas title, and `description` for its introduction.
- Change `defaultView` only to an existing `views` ID in
  `ui/src/views/registry.ts`. Keep Chat available.
- Read `ui/src/App.tsx`: a valid URL hash takes priority over `defaultView`.
  Verify a changed default without an old `#/<id>` hash.
- Keep `canvasId` stable. A display-name change is not a new extension identity;
  normally leave `extensionName` unchanged too.
- `resolveConfig` in `src/shared/node/config.mts` applies environment
  overrides. If the installed name differs from the JSON, check `ASSISTANT_NAME`
  before changing unrelated UI code or configuration defaults.
- Choose whether the assistant's name and the installed phone app's name should
  match. They are separate settings; do not promise that changing one updates both.

## 2. Edit tokens, not scattered colors

- Use `ui/src/styles.css` for shared colors, spacing, typography and shape.
  Components consume `--cc-*` tokens, not the Copilot host's variable names.
- The existing values prefer injected host colors and use fallbacks in a plain
  browser. Changing only a fallback may not change the embedded app. For a
  requested fixed accent, set the relevant `--cc-*` tokens deliberately and
  check both embedded and standalone rendering.
- Update `--cc-accent`, `--cc-accent-soft` and `--cc-accent-contrast` together.
  Check `--cc-focus` and keep danger, warning and success visually distinct.
- Define suitable light and dark values using the existing
  `prefers-color-scheme` sections. Do not assume a light accent's contrast ink
  remains legible in dark mode.
- Read `theme`, `tokenPalette`, `variantColorResolver` and
  `cssVariablesResolver` in `ui/src/theme.ts` before changing Mantine defaults.
  Keep its palettes and semantic variables connected to the CSS tokens.
- Preserve `usePrefersDark` and the system/host color preference unless the user
  explicitly requests a new theme-selection feature.
- Keep visible focus, readable muted text and reduced-motion behavior.
  Use the existing spacing/radius scales rather than adding one-off values
  throughout component styles.

## 3. Update phone branding when requested

- Edit `name`, `short_name` and, if appropriate, `description` in
  `ui/public/assets/manifest.webmanifest`.
- Keep the manifest's relative `start_url` and `scope`. Absolute paths would
  change behavior under the desktop capability prefix.
- Update the referenced images beside the manifest: `icon-192.png`,
  `icon-512.png` and `icon.svg`. Preserve declared sizes and a safe maskable
  composition; the same 512-pixel image currently serves both purposes.
- Read `ui/index.html` for the matching `apple-mobile-web-app-title`,
  `apple-touch-icon` (`icon-180.png`), favicon and initial document title.
  `App` replaces the document title after configuration loads.
- If changing phone browser chrome colors, update the manifest's `theme_color`
  and `background_color` plus the light/dark `theme-color` meta tags in
  `ui/index.html`. CSS tokens alone do not update those values.
- Use local, user-owned or permitted images. Keep assets beneath
  `ui/public/assets/` so the existing provider and gateway can serve them.

## 4. Inspect all appearances

- Preview light and dark schemes at desktop and phone widths. Check filled
  buttons, focus rings, menus, inputs, errors and long assistant names.
- Verify the new default on a fresh page without a view hash, then confirm that
  explicit navigation still selects another registered view.
- Check that manifest image references exist and their dimensions match the
  declarations. Inspect the phone home-screen name/icon separately from the
  page title; an already installed PWA may keep old branding until re-added.
- Run the repository checks and complete `customization-workflow`. Report any
  phone installation state you could not verify rather than claiming it updated.

## Don't

- Do not rename `canvasId` to change visible branding or remove existing views.
- Do not put secrets or personal service credentials in `template.config.json`.
- Do not add a theme library, remote font or heavy icon dependency for this task.
- Do not hand-edit the installed copy or generated `extension/`; edit source.
- Do not replace the canvas with a native app panel or alter its security checks.
