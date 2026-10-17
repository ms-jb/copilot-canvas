# copilot-canvas-starter

A small TypeScript starter for a Copilot app **canvas extension**: a chat panel that shows the
conversation of the session it is installed in and lets you send messages to that same session.
An optional loopback **gateway** lets you open the same panel from another browser through a
private dev tunnel.

```
extension-src/   extension host (.mts) -> compiled to extension/
ui/              React + Mantine renderer -> built to extension/ui/
gateway/         optional loopback proxy (gateway.mts)
extension/       generated, committed, installable output (do not hand-edit)
```

## Prerequisites

- Node.js 22.18 or newer (24 recommended). The gateway and scripts run as TypeScript directly
  through Node's type stripping, so code must be erasable TypeScript (no enums or namespaces).
- npm. Tooling is [Vite+](https://viteplus.dev) (`vp`), installed locally.

## Quick start

```bash
npm install
npx vp run install-ext
```

This builds and copies `extension/` to `~/.copilot/extensions/<name>/` (`COPILOT_HOME` changes the
root). Reload extensions in the Copilot app and open the **Chat Panel** canvas. Pass
`[name] [--force] [--dir <extensions-root>]` to change the target; it never overwrites a folder it
did not create unless you pass `--force`.

### Install from GitHub instead

`extension/` is committed and installable as-is. In the app's **Install canvas extension** dialog,
paste the folder URL `https://github.com/<owner>/<repo>/tree/<ref>/extension`, or share the
`extension/` contents as a gist.

## Develop

- `npx vp check` – format, lint and type-check
- `npx vp test` – small unit tests (contract, transcript, markdown, Host/Origin, gateway)
- `npx vp build` – build the renderer and compile the host into `extension/`

Rebuild and commit `extension/` after changing `extension-src/`, `ui/` or `template.config.json`;
CI fails if it is out of date.

## Customize

Edit `template.config.json`. Environment variables override it.

| Field                  | Env                      | Meaning                               |
| ---------------------- | ------------------------ | ------------------------------------- |
| `extensionName`        | `EXTENSION_NAME`         | install folder name                   |
| `canvasId`             | `CANVAS_ID`              | canvas id                             |
| `displayName`          | `CANVAS_DISPLAY_NAME`    | title shown in the app                |
| `description`          | –                        | canvas description                    |
| `defaultView`          | –                        | view opened first                     |
| `gatewayPort`          | `GATEWAY_PORT`           | gateway port (default 47600)          |
| `gatewayAllowedOrigin` | `GATEWAY_ALLOWED_ORIGIN` | extra browser origin allowed (tunnel) |

### Add a view

Create a component that takes `ViewProps` in `ui/src/views/`, then add an entry (`id`, `title`,
`icon`, `component`) to `ui/src/views/registry.ts`. It shows up in the navigation at `#/<id>`.

## Gateway and dev tunnel (optional)

The extension serves the panel on `127.0.0.1` under an unguessable path. The gateway is a separate
process that forwards only the panel's endpoints, so a tunnel can expose one fixed port.

```bash
npm run gateway    # 127.0.0.1:47600
```

Expose it with an **owner-only** dev tunnel (never anonymous access):

```bash
devtunnel user login
devtunnel create
devtunnel port create -p 47600
devtunnel host
```

The tunnel rewrites `Host` to `localhost` and passes `Origin` through, so set
`GATEWAY_ALLOWED_ORIGIN` to the exact tunnel origin (for example
`https://<tunnel-id>-47600.<region>.devtunnels.ms`) and restart the gateway. Open it in a browser
signed in as the tunnel owner. If the canvas is not open in the app, the gateway answers
"not connected".

## Safety model

- The panel reads and writes only the session it is installed in. It never answers permission or
  question prompts; it shows "waiting" and you answer in the app.
- The extension's server listens on loopback only, behind a random path, and checks `Host`,
  `Origin`, a per-run CSRF token and a per-run generation (a restarted extension is refused as
  stale). It sets no CORS headers and marks sensitive responses `no-store`.
- Sends are never retried automatically. An unconfirmed send is shown as "might not have been
  delivered" and the draft is kept.
- Markdown is parsed to plain data with no raw HTML; only `http`, `https` and `mailto` links work.
- The gateway binds loopback only, forwards an allow-list of paths, strips cookies and
  authorization, and never logs transcripts or tokens.
- `template.config.json` ships with the extension: keep secrets out of it.

## Troubleshooting

- **Canvas missing**: reload extensions and check `~/.copilot/extensions/<name>/extension.mjs` exists.
- **"UI not built"**: run `npx vp build`, reinstall, reload.
- **Gateway "not connected"**: open the canvas in the app first, then reload the browser page
  (the extension gets a new generation on every reload).
- **403 through the tunnel**: `GATEWAY_ALLOWED_ORIGIN` must equal the browser's origin exactly.

## License

MIT
