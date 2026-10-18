# Set up Copilot Canvas

This is the setup playbook Copilot follows when you click **Install in GitHub Copilot** (or paste
_"Set up Copilot Canvas by following https://github.com/ms-jb/copilot-canvas/blob/main/SETUP.md"_
into any Copilot chat). You don't need to run any of it yourself.

---

**For Copilot.** Get the user to a canvas they own, on desktop and on their phone, as fast as you
can. Then help them change it (Part 2) and help them build the rest of their Copilot setup
(Part 3), while builders write the code in the background. Use the platform's shell and paths
(Windows or macOS). The user needs a GitHub account with any Copilot plan (Copilot Free works,
within its monthly limits) and the GitHub Copilot app; README.md lists the rest.

**Read the latest version first.** If you are reading a local checkout, it may be older than the
template: run `git fetch` and read `SETUP.md` from `origin/main` (or from
`https://raw.githubusercontent.com/ms-jb/copilot-canvas/main/SETUP.md`), and follow that one.

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

0. **Consent (one question).** Say what will happen: their own copy of Copilot Canvas in
   `~/repos/copilot-canvas`, the canvas installed for their user, and phone access through a private
   dev tunnel that only they can sign in to. With `gh` signed in, the copy is a new **private**
   repository on their GitHub account made from this template (fresh history, not a fork), so they
   can keep and back up their changes; pushing is up to them. Without it, or if they prefer, it is a
   local folder only. Either way their copy never points back at this template. The one manual step
   is signing in on their phone. Choices: "Go (Recommended)", "Go, local folder only",
   "Go, but skip the phone", "Change folder", "Not now".

   **Right after "Go", start three lanes at once** and never wait for one before starting another:
   - **Canvas now** (step 1): the template ships a ready build, so the canvas opens in seconds,
     before anything is cloned or built.
   - **Phone** (step 4): the CLI install and sign-in need nothing from the source. Start the
     sign-in first, so the user does their part while the rest runs.
   - **Their copy** (steps 2 and 3): clone, `npm install`, build, then swap their own build in.

1. **Instant canvas** (the wow starts here). Open the template's prebuilt canvas immediately:
   - Look in `~/.copilot/extensions/` for other folders whose `template.config.json` has
     `"canvasId": "chat-panel"` and that are not named `copilot-canvas` (for example `extension`, from
     an earlier link install). Two copies show two canvases; offer to remove them.
   - `install_extension` with URL `https://github.com/ms-jb/copilot-canvas/tree/main/extension`,
     `name: copilot-canvas`, scope `user`. It installs the committed, already-built `extension/`
     and reloads extensions for you, so the user never taps a reload button. Never copy a folder in
     by hand first: a new extension folder only registers on a reload.
   - Wait about five seconds, then `open_canvas` with canvas id `chat-panel` and a stable
     `instanceId`; if it is not registered yet, retry twice, five seconds apart. Confirm it shows
     this conversation, and tell the user in one line that this is the starting version and their
     own copy replaces it in a minute.
   - If `install_extension` says the folder exists, try `open_canvas` first. If it is not
     registered (a folder copied earlier without a reload), rename
     `~/.copilot/extensions/copilot-canvas` to `~/.copilot/extensions/.copilot-canvas.unregistered`
     and run `install_extension` again; remove the renamed folder after step 3.
2. **Get their copy** into `<FOLDER>`, never inside the checkout this session started in:
   - If `<FOLDER>` exists, use it only if it is a git checkout of `copilot-canvas`; otherwise ask.
   - **Private copy** (default, needs `gh auth status` signed in to github.com):
     `gh repo create <login>/copilot-canvas --private --template ms-jb/copilot-canvas`, then
     `gh repo clone <login>/copilot-canvas <FOLDER>`. If `<login>/copilot-canvas` already exists,
     use it only if it is theirs and private; otherwise ask for another name. If they are
     `ms-jb` (the template's owner), ask for another name, for example `copilot-canvas-mine`.
   - **Local folder only** (no `gh`, or they chose it):
     `git clone https://github.com/ms-jb/copilot-canvas <FOLDER>`, then
     `git -C <FOLDER> remote remove origin`. They can publish it later with
     `gh repo create --private --source <FOLDER> --push`.
   - Check: `git -C <FOLDER> remote -v` lists nothing that points at `ms-jb/copilot-canvas` (unless
     they are its owner and chose to), and for a private copy
     `gh repo view <login>/copilot-canvas --json visibility` says `PRIVATE`.
   - Run `npm install` in `<FOLDER>` in a background shell and keep going. It needs Node.js 22.18+ (24 recommended). If Node is missing or
     older, check where `node` resolves first: when a version manager provides it (`pnpm env`, nvm, fnm,
     Volta, mise), upgrade through that manager, since a second install would compete on `PATH`.
     Otherwise install it with the platform's package manager (`winget install OpenJS.NodeJS.LTS`,
     `brew install node`). Ask first either way. If the registry fails, use `npm config get registry`;
     never edit `.npmrc` or install anything globally.
3. **Swap in their own build.** Once `npm install` has finished, `npm run install-ext` builds their
   copy first and installs only a build that passed, so nothing half-built is ever registered.
   - Run `npm run install-ext` in `<FOLDER>`. It swaps their build into
     `~/.copilot/extensions/copilot-canvas` in one step and records where the copy is, so later tweaks
     rebuild from it. The open canvas sees the new build and reloads itself.
   - Wait about five seconds, then `open_canvas` again (same `instanceId`) and confirm it shows this
     conversation. On the phone, a page refresh picks it up.
   - Only if the canvas does not switch (a build that predates self-reload), ask the user once to
     tap **Reload extensions** (the circular arrow in the canvas's top bar) or restart the Copilot
     app, then open it again.
4. **Phone** (skip if they chose to). Start the first two bullets right after consent, in the
   background, before the source is even cloned:
   - Install the dev tunnel CLI if missing (`winget install Microsoft.devtunnel`,
     `brew install --cask devtunnel`). On Windows a fresh install may not be on `PATH` in shells
     you already started; refresh `PATH` from the machine and user settings, or start a new shell.
   - **Sign-in needs the user, so make it impossible to miss.** If `devtunnel user show` is not
     signed in, start `devtunnel user login -g -d` (GitHub, device code) in its own background shell
     and read its output until the device code and link appear. Then ask a question (`ask_user`,
     choices "I've signed in", "Skip the phone") that contains the link and the code in its text;
     a blocking question cannot scroll past, and the other lanes keep running meanwhile. Say it is
     the account they will use on their phone. Do not bury the code in progress text. When they
     answer, check `devtunnel user show`.
   - Once `npm install` has finished, in `<FOLDER>` start `npm run devtunnel` with `NO_COLOR=1`
     as a long-lived, detached background process, with its output going to a file you can read. If
     the sign-in is still pending it prints the same device code, so relay it the same way. It
     creates or reuses their owner-only tunnel, refuses one with extra access, hosts it and
     starts the gateway, then prints `Open on phone: <link>`, a QR code and `QR image: <path>`. A
     new tunnel is named after their computer's user name when that name is free (for example
     `https://jordan-canvas-47600.usw2.devtunnels.ms`), otherwise it gets a random name. Tell the
     user the link shows that name.
   - **The moment that appears, open the QR code in the side panel so the user doesn't have to
     click for it.** Call `open_canvas` with `canvasId: "browser"`, a new `instanceId`
     (for example `phone-qr`), `input: { url: "file:///<path>", title: "Scan to open on phone",
     placement: { surface: "side", focus: true } }` (`<path>` is the printed `QR image:` path,
     `phone-qr.svg` in `~/.copilot/canvas-runtime/copilot-canvas/`, with forward slashes). If it
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
   - Offer to install it on the phone: the canvas walks them through **Add to Home Screen** for their
     phone and browser, and it then opens like an app.
   - After icon changes, tell the user to delete the existing home-screen app and add it again
     (**Share → Add to Home Screen**): iOS snapshots the icon when the app is added.
   - Then offer notifications: in the installed app, tap the bell, **Turn on**, then **Send test**.
     Confirm the test arrives. Pushes carry no content. Later notifications stay quiet while the app
     is open in front; the bell has a switch to change that.
5. **Show the wow: sessions working in parallel.** When the first phone message has arrived, say
   in one line what just happened (their phone is steering this conversation). Then show why it
   matters without a lecture: while you keep asking them questions, start two or three small,
   independent sessions so they appear in the canvas's recent sessions list, for example one that
   reads their recent GitHub activity (aggregates only, read-only) and proposes panels, and the
   first builder from Part 2. Use `create_session` with a `kickoff` prompt and
   `notify_on_idle: "once"` (see Part 2 for when a background `task` agent fits better). Tell them
   to open the sessions list, on the phone too, to watch each one work, and name the idea in a
   sentence: this conversation conducts, sessions do the work, the canvas is the remote control.
   Don't claim more than you see: report only what appears in the list.

## Part 2: Change the canvas

From here, this conversation asks the questions and a builder writes the code. The user keeps
answering questions and making choices while a build runs.

1. **Ask what they do** in two or three one-tap questions (one at a time, recommended option first):
   what they want at a glance (open pull requests, today's agenda, a scratchpad, a checklist), what to
   call the assistant, and anything off-limits. If WorkIQ or `gh` is available, offer to look at the
   last few weeks of their calendar or GitHub activity (aggregates only, read-only) to suggest panels.
2. **Hand the code to a builder.** Tell the user the smallest useful result and how they will check
   it. Then start a background `task` agent (general-purpose) in this conversation. Its permission
   requests show in this chat, so the user can approve them from the phone. Give it:
   - the user's request in their words, `<FOLDER>`, and the skill to follow (`add-view-or-panel`,
     `add-data-endpoint` or `theme-and-identity`, plus `customization-workflow`);
   - its job: change the source in `<FOLDER>`, add a test for new logic, run `npx vp check` and the
     affected tests (`npx vp test <file>`), then report the changed files, the check results and what
     the user should see;
   - its limits: it does not run `npm run install-ext`, commit, push, start other agents or ask the
     user anything. If it needs a decision, it stops and reports the question.
   - source layout: host readers and services belong in `src/host/`, browser-safe shared code in
     `src/shared/`, and Node-only helpers in `src/shared/node/`. The renderer consumes shared code
     through `ui/src/shared.ts`; never put host or gateway imports in a UI component.

   Run one builder at a time: builders share `<FOLDER>` and the installed canvas. Keep a list of the
   next canvas ideas instead. A one-line change to `template.config.json` (name, first view) needs no
   builder. If the user is at the computer and wants to watch the build in its own chat, offer a
   nested session instead: register `<FOLDER>` with `create_project`, then `create_session` for that
   project with `workspace_type: "branch"`, so it edits `<FOLDER>` and not a separate worktree. Tell
   them its permission requests show in that session on the computer, not on the phone.

3. **Start Part 3 at once.** Don't wait for the build.
4. **When the builder reports,** let the user finish the current question, then stop the Part 3 step:
   - If the builder stopped with a question, ask the user, then start a new builder with the answer.
   - Otherwise read the diff and run `npm run install-ext` in `<FOLDER>`. The open canvas reloads
     itself onto the new build; wait about five seconds, then `open_canvas` again (same
     `instanceId`). On the phone, a page refresh picks it up.
   - When they confirm they see the change, commit in `<FOLDER>` (source and the rebuilt
     `extension/`), suggest one next canvas idea, and continue Part 3 where it stopped.

## Part 3: Set up the rest of Copilot

The canvas is one part. The rest is how Copilot works for them in every chat: who they are, how
they like to work, skills for tasks they repeat, their own agents, automations and dashboards. Do
one stage at a time. They make the decisions and supply the content in their own words; you ask,
draft from their answers, show the draft and write it only after they approve. Do not copy someone
else's files, including this repository maintainer's. Explain how each piece works, so they can
ask for the next one without this guide.

**For every stage:**

- Say in one or two sentences what it is and what they get. Choices: "Start (Recommended)",
  "Skip for now", "Stop here".
- Ask one question at a time, recommended option first. Use what you learned in Part 2.
- Before you write a file, read what is already there. Show the merged result and keep their
  existing content. Say that personal files apply to every project, not only this one.
- Check that it works; each stage says how. If it loads only in a new chat, say so and check there.
- End with the one sentence they can use to do it again, for example _"Next time, say: make a
  skill for my weekly status note."_
- Keep progress in `~/.copilot/canvas-runtime/copilot-canvas/progress.md`: stages done or skipped,
  the next question, the builder in progress and any change waiting for the user's check. No
  private content and no approvals. When the user comes back, read it first and check for unfinished
  builder work before you start another.

`~` is the user's home folder (`%USERPROFILE%` on Windows).

1. **Profile** (`~/.copilot/copilot-instructions.md`). Instructions Copilot reads in every chat. Ask
   their role and what they work on, the tools and accounts they use, and words or names Copilot
   should know. Keep it under a page. Check: in a new chat, run `/instructions` and confirm the file
   is listed, then ask _"What do you know about me?"_. If they also use other agent tools and want one
   shared file, offer `~/.agents/AGENTS.md` instead, loaded through the
   `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` environment variable. Setting that variable changes their
   system settings, so ask first. For small facts, they can say _"remember that ..."_ in any chat.
2. **Working style.** How they and Copilot work together, added to the same file. Ask how they want
   replies (short or detailed, plain language, step by step); when Copilot should act and when it
   should ask first (a good default: act when a change is easy to undo and easy to see; ask before
   anything that sends, deletes, spends money or speaks for them); how to ask questions (one at a
   time, with choices); and what is off-limits. Check: ask for a small task in a new chat and
   confirm the reply follows the rules.
3. **A first skill** (`~/.copilot/skills/<name>/SKILL.md`). A skill is a written procedure that
   Copilot loads when a task matches. Ask which task they repeat or explain again and again: a status
   note, a review checklist, meeting prep. Ask for the steps, the inputs, the result and how they
   know it is done. Write a `name` and a `description` that says when to use it. Check: in a new
   chat, ask for the task in their usual words and confirm Copilot uses the skill. Give them a rule
   to reuse: _"When you correct me twice on the same thing, ask me to make it a skill."_
4. **Their own agent** (`~/.copilot/agents/<name>.agent.md`). An agent has its own instructions,
   and Copilot can give it a task: a reviewer, a researcher, a writer in their style.
   Ask what they want to hand off and what it must never do. They can also make one themselves with
   `/agent`, then **Create new agent**. Check: give it one small, harmless task and look at the
   result together.
5. **A first automation** (the app's **Automations** view). An automation runs a prompt in a new
   session, on demand or on a schedule: a morning summary, an end-of-week review. Scheduled
   automation needs its own consent (see Ground rules). Start read-only and manual: draft it with
   `save_workflow` (`interval: "manual"`, `user_confirmation: "dialog"`) so the user reviews and saves
   it. Say which project, data and actions it can use. With their approval, run it once and read the
   result together. Add a schedule only after a separate yes. Each run is a new session in the app;
   it does not show in this phone conversation.
6. **A dashboard** in the canvas. Turn something they track into a panel with a chart: open pull
   requests by age, meetings per day, tasks done this week. Use a builder (Part 2) with
   `add-data-endpoint` and `add-view-or-panel`. Start with simple bars drawn in CSS or SVG; ask
   before adding a chart library. The data is read-only, and it shows on the phone only if its route
   is added to the gateway.
7. **Next changes.** Suggest a backup for `~/.copilot/copilot-instructions.md`, `skills/` and
   `agents/` (a private git repository or their cloud folder; never secrets). Offer a short weekly
   review: _"What did I repeat or correct this week?"_ Each answer can become a skill, a rule in their
   profile or a panel. Remind them they can ask from any chat, and that the canvas's empty right-hand
   side has ideas.

## Troubleshooting

- **The canvas is missing:** run `npm run install-ext`, wait a few seconds and open it again. If it
  is not registered, follow the fallback in Part 1 step 1, or tap the canvas's reload
  button (restarting the Copilot app also works).
- **The canvas shows another copy's changes:** another folder in `~/.copilot/extensions` has the same
  canvas id; remove it.
- **The phone link stopped working:** the computer slept or `npm run devtunnel` stopped. Start it again.
- **A new panel works on desktop but is "Not found" on the phone:** the gateway reads its route list
  when `npm run devtunnel` starts. Restart it after a change to `gateway/`, and make sure the canvas
  picked up the new build so the provider serves the new route too.
- **"Not connected" on the phone:** the canvas was closed. Open it again in Copilot, then refresh the
  phone.
- **Undo:** stop `npm run devtunnel`; `devtunnel delete <tunnel-id>` (the id is in
  `~/.copilot/canvas-runtime/copilot-canvas/phone.json`); remove `~/.copilot/extensions/copilot-canvas`
  and `~/.copilot/canvas-runtime/copilot-canvas` (tunnel id, notification keys, subscriptions and
  setup progress); delete `<FOLDER>` and, if they want, their private repository
  (`gh repo delete <login>/copilot-canvas`, after they confirm). The profile, skills, agents and
  automations from Part 3 are not part of the canvas; they stay until the user removes them.
