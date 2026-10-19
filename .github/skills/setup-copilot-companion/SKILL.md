---
name: setup-copilot-companion
description: "Set up Copilot Companion for a user who has no copy yet: their own private copy, the companion open beside this chat, a phone link. Also for first changes during setup, setting up the rest of Copilot (profile, skills, agents, automations), and repairing or undoing an install."
---

# Set up Copilot Companion

This is the playbook Copilot follows when the user clicks **Install** in the README, or pastes
_"Set up Copilot Companion for me with the setup-copilot-companion skill"_ into any Copilot chat. The user
does not run any of it.

**For Copilot.** Get the user to a canvas they own, on desktop and on their phone, as fast as you
can. Then help them change it and set up the rest of their Copilot, while builders write the code
in the background. Use the platform's shell and paths (Windows or macOS). The user needs a GitHub
account with any Copilot plan (Copilot Free works) and the GitHub
Copilot app; README.md lists the rest. `<FOLDER>` is their copy's folder, `~/repos/copilot-companion`
unless they chose another.

**Read the latest version first.** A local checkout may be older than the template. Run `git fetch`
and read this skill from `origin/main` (or from
`https://raw.githubusercontent.com/ms-jb/copilot-companion/main/.github/skills/setup-copilot-companion/SKILL.md`,
with `references/` beside it). If the local copy is behind, follow the `origin/main` version.
Done when you know which version you follow.

**The point is a fast wow, and what it teaches.** Within minutes the user should (1) see the canvas
open beside this conversation, (2) send a message from their phone and watch it arrive here, and
(3) watch several sessions work at once while this conversation stays free. That last one is the
lesson: this conversation conducts, sessions do the work, the canvas is the remote control. Every
step below runs the slow things (installs, builds, sign-ins, the tunnel) in the background and
never blocks the user on them. Put each long command in its own background shell, keep talking,
and check on it.

## Ground rules

- **Consent.** Ask once at step 0. Ask again only for something it did not cover: installing
  software, remote publication, paid services or scheduled automation.
- **Security.** The tunnel is owner-only (never anonymous, tenant or organization access). The
  gateway binds to `127.0.0.1` only. Never answer permission prompts, questions or plan approvals
  for the user. No secrets in files, logs or chat.
- **Clicks only the user can make.** When a session needs a click (shell permission, trust prompt),
  take the user there and say exactly what to click. Don't switch its mode to get around it. When
  the user must enter a code or sign in somewhere, put the link and the code in a blocking question
  so it cannot be missed.
- **Plain language.** Many users are not developers. Say what is happening and what they will see; keep
  commands out of chat unless asked.
- **Verification.** Report a step as done only after you see the result: the canvas is connected, a
  phone message arrived, the checks pass. Report anything blocked as blocked.

## Part 1: Install

0. **Consent (one question).** Say what will happen: their own copy of Copilot Companion in
   `~/repos/copilot-companion`, the canvas installed for their user, and phone access through a private
   dev tunnel that only they can sign in to. With `gh` signed in, the copy is a new **private**
   repository on their GitHub account made from this template (fresh history, not a fork), so they
   can keep and back up their changes; pushing is up to them. Without it, or if they prefer, it is a
   local folder only. Either way their copy never points back at this template. The one manual step
   is signing in on their phone. Choices: "Go (Recommended)", "Go, local folder only",
   "Go, but skip the phone", "Change folder", "Not now".
   Done when the user has answered; "Not now" ends the setup.

   **Right after "Go", start three tracks at once** and never wait for one before starting another:
   - **(a) Canvas now** (step 1, this conversation): the template ships a ready build, so the canvas
     opens in seconds, before anything is cloned or built.
   - **(b) Phone** (step 2, this conversation): the CLI install and the sign-in question need nothing
     from the source. Start the sign-in first, so the user does their part while the rest runs. The
     tunnel start waits for track (c).
   - **(c) Their copy** (step 3): ONE background `task` agent (general-purpose) clones, installs,
     builds and swaps in their own build. This conversation does not wait on it.

   This conversation keeps consent, the sign-in question, the instant canvas and the talking with
   the user.

1. **Instant canvas** (track a; the wow starts here). Open the template's prebuilt canvas immediately:
   - Look in `~/.copilot/extensions/` for other folders whose `template.config.json` has
     `"canvasId": "chat-panel"` and that are not named `copilot-companion` (for example `extension`, from
     an earlier link install). Two copies show two canvases; offer to remove them.
   - `install_extension` with URL `https://github.com/ms-jb/copilot-companion/tree/main/extension`,
     `name: copilot-companion`, scope `user`. It installs the committed, already-built `extension/`
     and reloads extensions for you, so the user never taps a reload button. Never copy a folder in
     by hand first: a new extension folder only registers on a reload.
   - Wait about five seconds, then `open_canvas` with canvas id `chat-panel` and a stable
     `instanceId`; if it is not registered yet, retry twice, five seconds apart. Confirm it shows
     this conversation, and tell the user in one line that this is the starting version and their
     own copy replaces it in a minute.
   - If `install_extension` says the folder exists, try `open_canvas` first. If it is not
     registered (a folder copied earlier without a reload), rename
     `~/.copilot/extensions/copilot-companion` to `~/.copilot/extensions/.copilot-companion.unregistered`
     and run `install_extension` again; remove the renamed folder once step 4 has swapped in their build.

   Done when `open_canvas` shows this conversation.

2. **Phone: CLI and sign-in** (track b; skip if they chose to). Start right after consent, in the
   background, before the source is even cloned:
   - Install the dev tunnel CLI if missing (`winget install Microsoft.devtunnel`,
     `brew install --cask devtunnel`). On Windows a fresh install may not be on `PATH` in shells
     you already started; refresh `PATH` from the machine and user settings, or start a new shell.
   - **Sign-in needs the user, so make it impossible to miss.** If `devtunnel user show` is not
     signed in, start `devtunnel user login -g -d` (GitHub, device code) in its own background shell
     and read its output until the device code and link appear. Then ask a question (`ask_user`,
     choices "I've signed in", "Skip the phone") that contains the link and the code in its text;
     a blocking question cannot scroll past, and the other tracks keep running meanwhile. Say it is
     the account they will use on their phone. Do not bury the code in progress text. When they
     answer, check `devtunnel user show`.

   Done when `devtunnel --version` runs and `devtunnel user show` shows a signed-in user (or the
   user chose "Skip the phone").

3. **Their copy** (track c): start ONE background `task` agent (general-purpose) right after "Go".
   Its permission requests show in this chat; take the user to each click (see Ground rules). Give it
   this brief, with the inputs filled in:
   - **Inputs:** `<FOLDER>`; whether the copy is a private repository (then the GitHub `<login>`,
     from `gh auth status`) or a local folder only; the template URL
     `https://github.com/ms-jb/copilot-companion`.
   - **Job:**
     1. Get their copy into `<FOLDER>`, never inside the checkout this session started in. If
        `<FOLDER>` exists, use it only if it is a git checkout of `copilot-companion`; otherwise stop and
        report the question.
        - **Private copy** (default, needs `gh auth status` signed in to github.com):
          `gh repo create <login>/copilot-companion --private --template ms-jb/copilot-companion`, then
          `gh repo clone <login>/copilot-companion <FOLDER>`. If `<login>/copilot-companion` already exists,
          use it only if it is theirs and private; otherwise stop and report, asking for another name.
          If they are `ms-jb` (the template's owner), stop and ask for another name, for example
          `copilot-companion-mine`.
        - **Local folder only** (no `gh`, or they chose it):
          `git clone https://github.com/ms-jb/copilot-companion <FOLDER>`, then
          `git -C <FOLDER> remote remove origin`. They can publish it later with
          `gh repo create --private --source <FOLDER> --push`.
        - Check: `git -C <FOLDER> remote -v` lists nothing that points at `ms-jb/copilot-companion` (unless
          they are its owner and chose to), and for a private copy
          `gh repo view <login>/copilot-companion --json visibility` says `PRIVATE`.
     2. Run `npm install` in `<FOLDER>` (use a background shell and wait for it). It needs Node.js
        22.18+ (24 recommended). If Node is missing or older, check where `node` resolves first:
        when a version manager provides it (`pnpm env`, nvm, fnm, Volta, mise), the fix is an upgrade
        through that manager, since a second install would compete on `PATH`; otherwise the fix is the
        platform's package manager (`winget install OpenJS.NodeJS.LTS`, `brew install node`). Either way,
        stop and report the question before installing. If the registry fails, read
        `npm config get registry`; never edit `.npmrc` or install anything globally.
     3. Run `npm run install-ext` in `<FOLDER>`. It builds their copy first and installs only a build
        that passed, so nothing half-built is ever registered. It swaps their build into
        `~/.copilot/extensions/copilot-companion` in one step and records where the copy is, so later
        tweaks rebuild from it. The open canvas sees the new build and reloads itself.
     4. Record which template version the copy started from, so it can be updated later with the
        `update-copilot-companion` skill: run `node scripts/upstream-sync.mts record` in `<FOLDER>` (it
        reads the template's latest commit and adds no remote), then
        `git add .template-sync.json` and commit it as "Record the template version this copy started
        from". Skip it only if `.template-sync.json` already exists.
   - **Limits:** it works only in `<FOLDER>` and in the
     `~/.copilot/extensions/copilot-companion` swap-in done by `npm run install-ext`. It never asks the
     user: when it needs a decision (Node install, name clash, `gh` not signed in) it stops and
     reports the exact question. It does not start other agents, publish beyond the consented
     private repository, or touch other folders.
   - **Report:** the folder path; the `git remote -v` result; the repository visibility check
     (private copy only); the `npm install` result; the `npm run install-ext` result; anything
     blocked, with the exact question.

   Do not wait on it. Keep step 1, step 2 and the conversation going. If it returns a question,
   relay it to the user, then start a new agent with the answer added to the brief.
   Done when the agent has reported with the folder, remotes, install and `install-ext` results all
   present and nothing blocked.

4. **When the copy reports: switch to it and bring up the phone.**
   - Wait about five seconds, then `open_canvas` again (same `instanceId`) and confirm it shows this
     conversation. On the phone, a page refresh picks it up. Only if the canvas does not switch (a
     build that predates self-reload), ask the user once to tap **Reload extensions** (the circular
     arrow in the canvas's top bar) or restart the Copilot app, then open it again.
   - Skip the rest of this step if they skipped the phone. In `<FOLDER>`, start `npm run devtunnel`
     with `NO_COLOR=1` as a long-lived, detached background process, with its output going to a file
     you can read. If the sign-in is still pending it prints the same device code, so relay it the
     same way as in step 2. It creates or reuses their owner-only tunnel, refuses one with extra
     access, hosts it and starts the gateway, then prints `Open on phone: <link>`, a QR code and
     `QR image: <path>`. A new tunnel is named after their computer's user name when that name is
     free (for example `https://jordan-canvas-47600.usw2.devtunnels.ms`), otherwise it gets a random
     name. Tell the user the link shows that name.
   - **The moment that appears, open the QR code in the side panel so the user doesn't have to
     click for it.** Call `open_canvas` with `canvasId: "browser"`, a new `instanceId`
     (for example `phone-qr`), `input: { url: "file:///<path>", title: "Scan to open on phone",
     placement: { surface: "side", focus: true } }` (`<path>` is the printed `QR image:` path,
     `phone-qr.svg` in `~/.copilot/canvas-runtime/copilot-companion/`, with forward slashes). If it
     does not open, retry without `placement`.
   - **Also post the link and the QR code in chat.** Attach the QR image: copy `<path>` into your
     session files and attach it. If you cannot attach images, paste the printed QR exactly as
     printed in a plain code block. Ask the user to scan it and sign in. The canvas is already
     open, so the phone connects as soon as the gateway is up.
   - Tell the user, in one line, that the phone only works while the Copilot app stays open on this
     computer: use an always-on machine, or turn on **Close to taskbar** so closing the window
     keeps the app (and the phone link) running.
   - The canvas's **Open on phone** button shows the same link and QR code. If the button is
     missing (the gateway started after the canvas opened), open the canvas again. Ask the user to
     send a message from the phone and confirm it arrives in this conversation.
   - **Dismiss the QR code once the phone works.** When the user's phone message has arrived here
     (or they say the phone is set up), close the `phone-qr` panel so it stops taking up the side
     panel: `invoke_canvas_action` on `phone-qr` with `evaluate_javascript` and `window.close();`.
     There is no close action, so confirm with `read_page` that the panel is gone. If it is still
     open, say so in one line and ask the user to close it with the **x** on its tab. Leave the
     link in chat and the canvas's **Open on phone** button alone: they show the same QR code
     whenever it is needed again.
   - Offer to install it on the phone: the canvas walks them through **Add to Home Screen** for their
     phone and browser, and it then opens like an app.
   - After icon changes, tell the user to delete the existing home-screen app and add it again
     (**Share → Add to Home Screen**): iOS snapshots the icon when the app is added.
   - Then offer notifications. The canvas asks by itself the first time it opens on the phone, in
     the installed app or in a browser tab: the user just approves the system prompt. If none
     appears, the first tap in the app triggers it (iOS requires a tap, and some browsers only show
     a quiet indicator). The bell has a slash through it until they approve; tapping it opens
     **Turn on** to ask again. Where the browser can't send notifications (an iPhone tab), the
     slashed bell points to **Add to Home Screen** instead. Once approved, have them tap the bell,
     then **Send test**, and confirm it arrives. Pushes carry no content, only a short preview line
     from their computer. They cover each reply, a question or approval waiting on them, and
     errors; the chat shows an unread count and the installed app's icon shows the same number. Later
     notifications stay quiet while the app is open in front; the bell has a switch to change that,
     and quiet hours for this phone. A user who turned notifications off, or blocked them in system
     settings, sees a plain bell and is not asked again.

   Done when the reopened canvas shows this conversation on their own build and, unless they skipped
   the phone, a phone message has arrived here.

5. **Show the wow: sessions working in parallel.** When the first phone message has arrived, say
   in one line what just happened (their phone is steering this conversation). Then show why it
   matters without a lecture: while you keep asking them questions, start two or three small,
   independent sessions so they appear in the canvas's recent sessions list, for example one that
   reads their recent GitHub activity (aggregates only, read-only) and proposes panels, and the
   first builder. Read [references/change-the-canvas.md](references/change-the-canvas.md) first: it
   has the builder brief and says when a background `task` agent fits better than a session. Use
   `create_session` with a `kickoff` prompt and `notify_on_idle: "once"`. Tell them to open the
   sessions list, on the phone too, to watch each one work, and name the idea in a sentence: this
   conversation conducts, sessions do the work, the canvas is the remote control. Don't claim more
   than you see: report only what appears in the list.
   Done when the user has seen the started sessions in the list (or the phone was skipped and you
   have said what the list shows).

## What comes next

- **Set up the rest of Copilot** (profile, working style, skills, agents, automations, a dashboard):
  read [references/rest-of-copilot.md](references/rest-of-copilot.md) when the first builder is
  running or the user asks for more.
- **Something is missing or broken, or the user wants it gone:** read
  [references/troubleshooting.md](references/troubleshooting.md) for the fixes and for Undo.
- **Keep their copy up to date:** the `update-copilot-companion` skill (offered as the last, optional
  stage in [references/rest-of-copilot.md](references/rest-of-copilot.md)) brings new template
  changes into their copy, with their changes kept.
