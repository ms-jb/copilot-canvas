---
name: add-view-or-panel
description: "Use for canvas requests such as 'add a sidebar view', 'add a panel with my PRs', or 'add a scratchpad'. Extend the existing React views or aside, not a native app panel."
---

# Add a view or panel

Read `AGENTS.md` and `.github/skills/customization-workflow/SKILL.md` for
scoping, approval, installation and delivery. This skill covers the UI change.
For external data, also use `add-data-endpoint`; for branding, use
`theme-and-identity`.

## 1. Choose the existing extension point

- Use a view for a destination that needs the center column. Create its component
  in `ui/src/views/` and add it to `views` in `ui/src/views/registry.ts`.
- Use an aside panel for compact information shown next to every view. Create its
  component in `ui/src/views/panels/` and add it to `asidePanels` in that registry.
- Read `ui/src/views/types.ts`. Both component types take `ViewProps`, whose only
  property is `connection`. Read `ChatView` for an actual consumer.
- A `ViewDefinition` needs `id`, `title`, `icon` and `component`. Use a unique,
  URL-safe ID; navigation uses `#/<id>`. The icon accepts optional `size`.
- An `AsidePanelDefinition` needs `id`, `title` and `component`, without an icon.
  `ui/src/layout/Aside.tsx` supplies the section heading; do not repeat it.
- `AddPanelCard` is the empty-aside suggestion helper, not a `ViewProps` panel
  example. Leave it as the fallback when the registry has no panels.

Finish this step with one chosen placement and a small list of files to change.

## 2. Reuse the connection and controls

- Read `Connection` in `ui/src/useConnection.ts`. Consume
  `connection.view.entries`, `.status`, `.controls` and `.prompts` as needed;
  read assistant identity from `connection.config`.
- Reuse the supplied connection. Do not call `useConnection` again in a view or
  open another event stream for the same session.
- Treat `connection.context` and `.config` as nullable during startup. Distinguish
  connection phases such as `bootstrapping`, `disconnected` and `stale` from the
  session activity in `connection.view.status`.
- Keep existing chat, pending prompts and session controls intact. A panel must
  never answer a permission, question or plan on mount or in a background effect.
- For new data, call the provider through `ui/src/api.ts`, not an external service
  from the browser. Follow `add-data-endpoint` before adding that integration.
- For notes or checklists, state what survives navigation, reload and a device
  change. Browser-local storage is not desktop-to-phone synchronization.

## 3. Fit the shell

- Use existing Mantine components and a colocated `.module.css`. Consume
  `--cc-*` tokens from `ui/src/styles.css`; let `ui/src/theme.ts` style Mantine.
- Give lists stable keys, readable wrapping, labelled controls and keyboard
  focus. Use loading, empty, error and retry states rather than a blank panel.
  Keep last-known data visibly stale when refresh fails; do not present it as live.
- Views own scrolling and readable width. Follow `Shell.module.css`:
  allow flex children to shrink with `min-height: 0` and `min-width: 0`, then
  scroll the intended content area instead of the whole document.
- Read `ui/src/layout/Shell.tsx`: the aside becomes a drawer on tablet and phone;
  navigation is also a drawer on phone. Fit narrow widths without fixed desktop
  dimensions, hover-only actions or horizontal page scrolling.
- `ui/src/layout/ViewStack.tsx` keeps visited views mounted while hidden.
  Do not assume navigation cleans up effects. Abort obsolete requests and clean
  up subscriptions; avoid starting duplicate polling when revisiting a view.
- Panels can unmount when their column or drawer closes. Preserve any user draft
  according to the agreed storage behavior.

## 4. Verify the UI, then deliver

- Use `npx vp dev` without Copilot. Check the default preview plus
  `?state=empty`, `?state=waiting`, `?state=busy`, `?state=nocontrols` and `?state=offline`.
- Add matching, non-private preview data in `scripts/dev-mock.mts` for new
  endpoints. Existing scenario flags do not automatically mock your new data.
- Check desktop, tablet and phone widths, both color schemes, drawer opening,
  long text, no results, failure and recovery. Return to Chat and verify drafts
  and pending prompts still behave as before.
- Add tests for new data transformations or state logic under `tests/`, using
  `vite-plus/test` as the existing tests do. Finish the checks and
  build/install/reload loop in `customization-workflow`.

## Don't

- Do not substitute a native app panel, My work tab or separate canvas for this edit.
- Do not add a heavy UI dependency for components Mantine already supplies.
- Do not hand-edit `extension/`; rebuild it from the source.
- Do not bypass explicit user taps or weaken the provider's request checks to
  make a new control work.
