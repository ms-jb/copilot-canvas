# Copilot Companion: agent guide

This repository is usually the user's own copy of Copilot Companion. When they ask to change the canvas
("add a panel", "rename the assistant", "show my agenda"), change **this code**, then rebuild and
reinstall it. Don't open a native app panel, a My work tab or a separate canvas instead. If you are
in a session without this repository and the user has no copy yet, follow the [setup-copilot-companion skill](.github/skills/setup-copilot-companion/SKILL.md).

## Where things live

| To change                        | Edit                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| A view in the left sidebar       | a component in `ui/src/views/`, listed in `views` in `registry.ts` |
| A panel in the right-hand aside  | a component in `ui/src/views/panels/`, listed in `asidePanels`     |
| Assistant name, first view       | `template.config.json` (`assistantName`, `defaultView`)            |
| Colors and spacing               | `ui/src/styles.css` (`--cc-*` tokens) and `ui/src/theme.ts`        |
| Phone app name and icon          | `ui/public/assets/manifest.webmanifest` and the icons beside it    |
| Data from outside the canvas     | a read-only endpoint in `src/host/` (below)                        |
| Shared wire types and validators | `src/shared/contract.mts` and `src/shared/contract/`               |
| Node configuration and runtime   | `src/shared/node/` (never imported by the renderer)                |

Views and panels take `ViewProps` (`connection`: transcript, status, settings, config). Build them
from native Mantine components (next section) and the existing `--cc-*` tokens.

`template.config.json` ships with the extension, so keep secrets out of it. `ASSISTANT_NAME`,
`EXTENSION_NAME`, `CANVAS_ID` (keep it stable), `GATEWAY_PORT` and `GATEWAY_ALLOWED_ORIGIN`
environment variables override its values.

## UI: native Mantine first

The renderer is Mantine 9. Compose its components; don't rebuild one from `div`s, raw elements and CSS.
Before writing any UI, look up the component in the Mantine docs (<https://mantine.dev/llms.txt> lists
every page) and in `ui/src`, and use what exists.

| Need                    | Use                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App frame               | `AppShell` (`Header`, `Navbar`, `Aside`, `Footer`, `Main`)                                                          |
| Layout                  | `Group`, `Stack`, `Flex`, `Grid`, `SimpleGrid`, `ScrollArea`, `Divider`                                             |
| Actions                 | `Button`, `ActionIcon`, `CloseButton`, `CopyButton`, `FileButton`                                                   |
| Menus and overlays      | `Menu`, `Popover`, `Modal`, `Drawer`, `Tooltip`, `HoverCard`                                                        |
| Forms                   | `TextInput`, `Textarea`, `Select`, `Checkbox`, `Switch`, `SegmentedControl`                                         |
| Content and status      | `Card`, `Paper`, `Badge`, `Table`, `Progress`, `RingProgress`, `Skeleton`, `Loader`, `Indicator`, `Avatar`, `Image` |
| Navigation and feedback | `NavLink`, `Tabs`, `Anchor`, `Alert`, `Notification`                                                                |
| Behavior                | `@mantine/hooks`: `useDisclosure`, `useMediaQuery`, `useClipboard`, `useReducedMotion`                              |

- Style with props first (`variant`, `color`, `size`, `radius`), then app-wide defaults in
  `ui/src/theme.ts`. Add a colocated `.module.css` only for what props and the theme can't express,
  using `--cc-*` tokens and the Styles API (`classNames`, `vars`), never Mantine's internal class names.
- `UnstyledButton` is for a clickable with a genuinely custom look; `Box component="header"` only for
  a semantic wrapper no layout component fits. `<svg>`, `<video>` and Markdown output stay raw.
- Lint enforces this: `react/forbid-elements` in `vite.config.ts` rejects raw `button`, `input`,
  `select`, `textarea`, `dialog`, `progress`, `table`, `img`, `a` and the landmark elements in
  `ui/**/*.tsx`. Markdown output (`ui/src/MarkdownView.tsx`) is exempt, and files that predate the
  rule are listed in `mantineDebt`. Migrate a debt file to Mantine and remove it from the list;
  never add a file to either list or disable the rule.

**Data.** The page can only call its own provider. For outside data (pull requests, calendar), add a
`GET` endpoint: the path in `API` and its response shape in `src/shared/contract.mts`, the
route in `src/host/http/routes.mts`, and the read in the host (for example `gh` through
`execFile` with a timeout, never a shell string). Keep tokens in the host. Add it to the gateway's
`ROUTES` (`gateway/server/request-policy.mts`) only if it should work on the phone, and only for reads, then restart `npm run devtunnel`.

Keep browser-safe shared modules independent of host, gateway and Node code. The renderer imports
them only through `ui/src/shared.ts`. The gateway may use `src/shared/node/`, but never `src/host/`.
`vite.config.ts` enforces these import boundaries and runtime-cycle checks on top of Vite+ defaults.

## The loop

A background builder does steps 1 and 2 and reports. The conversation the user talks to does the
rest and keeps guiding them meanwhile (see `customization-workflow`).

1. Preview without Copilot: `npx vp dev` (`?state=empty|waiting|busy|nocontrols|offline` for other
   states). `DEV_PUBLIC_URL=https://...` changes the preview's Open on phone origin;
   `DEV_PUBLIC_URL=off` hides it.
2. Check: `npx vp check` and `npx vp test`. Add a test for new logic. `npx vp build` builds the
   canvas into `extension/` on its own, if you need that without a full install.
3. Install: `npm run install-ext [name] [--force] [--dir <extensions-root>]` (builds, then installs
   from this copy). It replaces only an earlier install of this canvas (its own or a link install
   with the same canvas id) unless you pass `--force`, and records where it was installed from so
   the canvas's suggestions point Copilot at this copy.
4. The open canvas reloads itself onto the new build a few seconds after `install-ext` (it watches
   its install marker). Open the canvas again and confirm the change is visible; don't ask the user
   to tap **Reload extensions** unless the canvas runs a build from before self-reload. Reloading
   never restarts the phone gateway: after changing `gateway/` or the shared contract it imports,
   restart `npm run devtunnel` too, or the phone keeps rejecting new routes with 404.
5. Commit, including the rebuilt `extension/` folder. Pushing is the user's choice; ask first. Their
   copy should be their own private repository made from the template (`setup-copilot-companion` step 3). If
   `origin` still points at `ms-jb/copilot-companion` and they don't own it, don't push there: offer
   `git remote remove origin` and `gh repo create --private --source . --push` instead.
6. Suggest one or two next tweaks that build on what they just asked for.
   During setup, go back to the `setup-copilot-companion` `references/rest-of-copilot.md` stage where the user stopped.

Requires Node.js 22.18+. Code is erasable TypeScript (no enums or namespaces).

**Structure.** Read [ARCHITECTURE.md](ARCHITECTURE.md) before you add a folder or move code: it has
the layering rules (enforced by lint), where shared code goes and how to keep modules small and
testable.

**Skills.** Follow `.github/skills/customization-workflow` for every change, plus
`add-view-or-panel` for UI, `add-data-endpoint` for outside data and `theme-and-identity` for names,
colors and the phone app's branding.

## Phone tunnel

`npm run devtunnel` signs in to dev tunnels with GitHub (`devtunnel user login -g -d`) if needed, then creates an
owner-only tunnel once and remembers its id outside the repository; a tunnel that grants anyone
else access is refused, never changed. It adds port 47600 with `--origin-header unchanged`, so the
gateway can check the phone's exact address, then hosts the tunnel and starts the gateway with
`GATEWAY_ALLOWED_ORIGIN` set to the tunnel's address.

## Push a notice to the phone

`npm run notify -- "<title>" "<body>" [url]` pushes a notice to every subscribed phone, even one
with the canvas open, and prints `{"sent":N,"failed":M}`. It exits 1 when nothing was delivered,
the gateway is down or the token is refused, and 2 on wrong usage. The `url` (opened on tap) is a
path starting with `/` or an `http(s)` URL; limits are title 80, body 300 and url 500 characters,
with no control characters.

It calls the gateway's `POST /api/push/notify` (`gateway/server/notify-route.mts`), which only
accepts loopback connections with no `Origin`, `Referer`, cookies, `Sec-Fetch-*`, `Forwarded`,
`Via`, `X-Forwarded-*` or `X-MS-*` headers, and requires `Authorization: Bearer <token>`. The token
is the real gate, since tunnel traffic also arrives on loopback: 32 random bytes in the owner-only
`notify-token` file in the runtime folder. The gateway creates it at start when notifications are
on, keeps a valid private one across restarts, and replaces one that is malformed or readable by
others. Delete the file and restart the gateway to rotate it. Never print, log or serve the token,
and never add this route to `ROUTES`.

## Keep it safe

- Loopback only: never bind the provider or gateway to anything but `127.0.0.1`.
- Every state-changing request keeps the CSRF, generation and session checks in `server.mts`.
- Nothing is approved automatically: permission requests, questions and plans are answered only by
  an explicit tap from the user.
- The phone tunnel stays owner-only. Never add anonymous, tenant or organization access.
- No secrets in `template.config.json`, the repository or `extension/`: it all ships to the canvas.
- No external services or API keys in the template itself: dictation is the browser's own
  `SpeechRecognition` only (no hosted speech-to-text, no audio uploaded to the host). A user's copy
  may add its own.

## Contributing to the template

This applies only when you are changing `ms-jb/copilot-companion` itself, not a user's copy. The
template accepts pull requests, but only its owner pushes to `main`: open a branch and a pull
request, never push to `main` directly. Keep a pull request to one generic change, with no personal
names, accounts, hosts, keys or branding, and pass `npx vp check`, `npx vp test` and
`npm run build` (commit the rebuilt `extension/`) before opening it.
