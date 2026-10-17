# Set up Copilot Canvas

This is the setup playbook Copilot follows when you click **Install in GitHub Copilot** (or paste
_"Set up Copilot Canvas by following https://github.com/ms-jb/copilot-canvas/blob/main/SETUP.md"_
into any Copilot chat). You don't need to run any of it yourself.

---

**For Copilot.** Get the user from this page to a canvas they own, on desktop and on their phone,
in about five minutes. Then help them make it theirs and keep tweaking it. Use the platform's shell
and paths (Windows or macOS).

## Ground rules

- **One consent, then move.** Ask once at step 0. Ask again only for something it did not cover:
  installing software, remote publication, paid services or scheduled automation.
- **Safe by default.** The tunnel is owner-only (never anonymous, tenant or organization access). The
  gateway binds to `127.0.0.1` only. Never answer permission prompts, questions or plan approvals
  for the user. No secrets in files, logs or chat.
- **Human-only clicks.** When a session needs a click (shell permission, trust prompt), take the user
  there and say exactly what to click. Don't switch its mode to get around it.
- **Plain language.** Many users are not developers. Say what is happening and what they will see; keep
  commands out of chat unless asked.
- **Prove, don't claim.** Something is done only when observed: the canvas is connected, a phone
  message arrived, the checks pass. Report anything blocked as blocked.

## Part 1: Install (about five minutes)

0. **Consent (one question).** Say what will happen: a copy of Copilot Canvas in `~/repos/copilot-canvas`
   (a fork on their GitHub account when `gh` is signed in, so they can keep their changes; pushing
   is up to them, and a fork of this public repository is public), the canvas installed for their
   user, and phone access through a private dev tunnel that only they can sign in to. The one manual
   step is signing in on their phone. Choices: "Go (Recommended)", "Go, but skip the phone",
   "Change folder", "Not now".
1. **Get the source** into `<FOLDER>`, never inside the checkout this session started in:
   - If `<FOLDER>` exists, use it only if it is a git checkout of `copilot-canvas`; otherwise ask.
   - With `gh auth status` signed in to github.com: `gh repo fork ms-jb/copilot-canvas --clone=false`
     (reuses an existing fork), then `gh repo clone <login>/copilot-canvas <FOLDER>`. If they own
     `ms-jb/copilot-canvas` (GitHub can't fork your own repository), clone it directly instead.
   - Without it: `git clone https://github.com/ms-jb/copilot-canvas <FOLDER>`. They can fork later.
   - Run `npm install` in `<FOLDER>`. It needs Node.js 22.18+ (24 recommended); if Node is missing,
     install it with the platform's package manager (`winget install OpenJS.NodeJS.LTS`,
     `brew install node`) after asking. If the registry fails, use `npm config get registry`; never edit
     `.npmrc` or install anything globally.
2. **Install and open the canvas.**
   - Look in `~/.copilot/extensions/` for other folders whose `template.config.json` has
     `"canvasId": "chat-panel"` and that are not named `copilot-canvas` (for example `extension`, from
     an earlier link install). Two copies show two canvases; offer to remove them.
   - `install_extension` with the user's fork folder URL
     (`https://github.com/<login>/copilot-canvas/tree/main/extension`, or this repository's when there is
     no fork), `name: copilot-canvas`, scope `user`. It reloads extensions for you.
   - Run `npm run install-ext` in `<FOLDER>`. It installs the same canvas from their copy and records
     where that copy is, so later tweaks rebuild from it.
   - `open_canvas` with the canvas id from the result and a stable `instanceId`. Confirm it shows this
     conversation.
3. **Phone** (skip if they chose to):
   - Install the dev tunnel CLI if missing (`winget install Microsoft.devtunnel`,
     `brew install --cask devtunnel`).
   - If `devtunnel user show` is not signed in, run `devtunnel user login -d` and show the device code and
     link. The user finishes it in a browser with the account they will use on their phone.
   - In `<FOLDER>`, start `npm run phone` as a long-lived, detached background process. It creates or
     reuses their owner-only tunnel, refuses one with extra access, hosts it and starts the gateway, then
     prints the phone link and a QR code. Read the link from its output.
   - Reopen the canvas so its **Open on phone** button appears. Ask the user to scan the QR code, sign
     in, and send a message from the phone. Confirm it arrives in this conversation.
   - Offer **Add to Home Screen** on the phone: the canvas installs like an app.

## Part 2: Make it yours

1. **Ask what they do** in two or three one-tap questions (one at a time, recommended option first):
   what they want at a glance (open pull requests, today's agenda, a scratchpad, a checklist), what to
   call the assistant, and anything off-limits. If WorkIQ or `gh` is available, offer to look at the
   last few weeks of their calendar or GitHub activity (aggregates only, read-only) to suggest panels.
2. **Build in their copy.** Register `<FOLDER>` as a project and start a session there, so its
   `AGENTS.md` applies. Brief it with their choices. It follows `AGENTS.md`: change the canvas
   source, run the checks, `npm run install-ext`, then the user taps **Reload extensions** in the canvas.
3. **Hand over the habit.** Tell them that customizing never ends: they can ask for a change from any
   chat, or tap a suggestion in the canvas's empty right-hand side. Suggest two or three next tweaks
   based on what they picked.

## Troubleshooting

- **The canvas is missing:** run `npm run install-ext`, then reload extensions (the canvas's reload
  button, or restart the Copilot app).
- **The canvas shows another copy's changes:** another folder in `~/.copilot/extensions` has the same
  canvas id; remove it.
- **The phone link stopped working:** the computer slept or `npm run phone` stopped. Start it again.
- **"Not connected" on the phone:** the canvas was closed. Open it again in Copilot, then refresh the
  phone.
- **Undo:** stop `npm run phone`; `devtunnel delete <tunnel-id>` (the id is in
  `~/.copilot/canvas-runtime/copilot-canvas/phone.json`); remove `~/.copilot/extensions/copilot-canvas`;
  delete `<FOLDER>`.
