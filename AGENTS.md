# Copilot Canvas: agent guide

This repository is usually the user's own copy of Copilot Canvas. When they ask to change the canvas
("add a panel", "rename the assistant", "show my agenda"), change **this code**, then rebuild and
reinstall it. Don't open a native app panel, a My work tab or a separate canvas instead. If you are
in a session without this repository and the user has no copy yet, follow [SETUP.md](SETUP.md).

## Where things live

| To change                       | Edit                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| A view in the left sidebar      | a component in `ui/src/views/`, listed in `views` in `registry.ts` |
| A panel in the right-hand aside | a component in `ui/src/views/panels/`, listed in `asidePanels`     |
| Assistant name, first view      | `template.config.json` (`assistantName`, `defaultView`)            |
| Colors and spacing              | `ui/src/styles.css` (`--cc-*` tokens) and `ui/src/theme.ts`        |
| Phone app name and icon         | `ui/public/assets/manifest.webmanifest` and the icons beside it    |
| Data from outside the canvas    | a read-only endpoint on the host (below)                           |

Views and panels take `ViewProps` (`connection`: transcript, status, settings, config). Use Mantine
components and the existing `--cc-*` tokens so additions match the rest of the canvas.

**Data.** The page can only call its own provider. For outside data (pull requests, calendar), add a
`GET` endpoint: the path in `API` and its response shape in `extension-src/shared/contract.mts`, the
route in `extension-src/lib/server.mts`, and the read in the host (for example `gh` through
`execFile` with a timeout, never a shell string). Keep tokens in the host. Add it to the gateway's
`ROUTES` only if it should work on the phone, and only for reads, then restart `npm run phone`.

## The loop

1. Preview without Copilot: `npx vp dev` (`?state=empty|waiting|busy|offline` for other states).
2. Check: `npx vp check` and `npx vp test`. Add a test for new logic.
3. Install: `npm run install-ext` (builds, then installs from this copy).
4. Ask the user to tap **Reload extensions** (the circular arrow in the canvas's top bar) and to open
   the canvas again. Confirm the change is visible.
5. Commit, including the rebuilt `extension/` folder. Pushing is the user's choice; ask first. If
   `origin` is still `ms-jb/copilot-canvas` and they don't own it, remind them a push needs their own
   fork first (`gh repo fork --remote` makes the fork `origin`).
6. Suggest one or two next tweaks that build on what they just asked for. Customizing never ends.

Requires Node.js 22.18+. Code is erasable TypeScript (no enums or namespaces).

**Skills.** Follow `.github/skills/customization-workflow` for every change, plus
`add-view-or-panel` for UI, `add-data-endpoint` for outside data and `theme-and-identity` for names,
colors and the phone app's branding.

## Keep it safe

- Loopback only: never bind the provider or gateway to anything but `127.0.0.1`.
- Every state-changing request keeps the CSRF, generation and session checks in `server.mts`.
- Nothing is approved automatically: permission requests, questions and plans are answered only by
  an explicit tap from the user.
- The phone tunnel stays owner-only. Never add anonymous, tenant or organization access.
- No secrets in `template.config.json`, the repository or `extension/`: it all ships to the canvas.
