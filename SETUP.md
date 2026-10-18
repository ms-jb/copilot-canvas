# Set up Copilot Canvas

This is the setup playbook Copilot follows when you click **Install in GitHub Copilot** (or paste
_"Set up Copilot Canvas by following https://github.com/ms-jb/copilot-canvas/blob/main/SETUP.md"_
into any Copilot chat). You don't need to run any of it yourself.

---

**For Copilot.** Get the user from this page to a canvas they own, on desktop and on their phone.
Then help them change it (Part 2) and help them build the rest of their Copilot setup (Part 3),
while a builder writes the code in the background. Use the platform's shell and paths (Windows or
macOS). The user needs a GitHub account with any Copilot plan (Copilot Free works, within its
monthly limits) and the GitHub Copilot app; README.md lists the rest.

## Ground rules

- **Consent.** Ask once at step 0. Ask again only for something it did not cover: installing
  software, remote publication, paid services or scheduled automation.
- **Security.** The tunnel is owner-only (never anonymous, tenant or organization access). The
  gateway binds to `127.0.0.1` only. Never answer permission prompts, questions or plan approvals
  for the user. No secrets in files, logs or chat.
- **Clicks only the user can make.** When a session needs a click (shell permission, trust prompt),
  take the user there and say exactly what to click. Don't switch its mode to get around it.
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
1. **Get the source** into `<FOLDER>`, never inside the checkout this session started in:
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
   - Run `npm install` in `<FOLDER>`. It needs Node.js 22.18+ (24 recommended). If Node is missing or
     older, check where `node` resolves first: when a version manager provides it (`pnpm env`, nvm, fnm,
     Volta, mise), upgrade through that manager, since a second install would compete on `PATH`.
     Otherwise install it with the platform's package manager (`winget install OpenJS.NodeJS.LTS`,
     `brew install node`). Ask first either way. If the registry fails, use `npm config get registry`;
     never edit `.npmrc` or install anything globally.
2. **Build, install, then open the canvas.** The user never taps a reload button; open the canvas
   only once their own build is running.
   - Look in `~/.copilot/extensions/` for other folders whose `template.config.json` has
     `"canvasId": "chat-panel"` and that are not named `copilot-canvas` (for example `extension`, from
     an earlier link install). Two copies show two canvases; offer to remove them.
   - Run `npm run install-ext` in `<FOLDER>`. It builds their copy, swaps it into
     `~/.copilot/extensions/copilot-canvas` in one step and records where the copy is, so later tweaks
     rebuild from it. A running canvas sees the new build and reloads itself.
   - Wait about five seconds, then `open_canvas` with canvas id `chat-panel` and a stable
     `instanceId`. Confirm it shows this conversation.
   - **If it reports the canvas is not registered** (a first install, or a folder copied earlier
     without a reload), register it once: a new extension folder only registers on an extensions
     reload, and `install_extension` does that reload. It refuses an existing folder, so first rename
     `~/.copilot/extensions/copilot-canvas` to `~/.copilot/extensions/.copilot-canvas.unregistered`.
     Then `install_extension` with URL `https://github.com/ms-jb/copilot-canvas/tree/main/extension`,
     `name: copilot-canvas`, scope `user`. Run `npm run install-ext` again to put their own build
     back (the canvas reloads itself onto it), remove the renamed folder, wait about five seconds
     and `open_canvas` again.
   - Only if the canvas still runs an older build that predates self-reload (no change after
     `install-ext`), ask the user once to tap **Reload extensions** (the circular arrow in the
     canvas's top bar), then open it again.
3. **Phone** (skip if they chose to). Start this as soon as `npm install` finishes, alongside step 2,
   so the user can move to their phone early:
   - Install the dev tunnel CLI if missing (`winget install Microsoft.devtunnel`,
     `brew install --cask devtunnel`).
   - If `devtunnel user show` is not signed in, run `devtunnel user login -g -d` (GitHub, device code) and show the device code and
     link. The user finishes it in a browser with the account they will use on their phone.
   - In `<FOLDER>`, start `npm run phone` with `NO_COLOR=1` as a long-lived, detached background
     process. It creates or reuses their owner-only tunnel, refuses one with extra access, hosts it and
     starts the gateway, then prints `Open on phone: <link>`, a QR code and `QR image: <path>`. A
     new tunnel is named after their computer's user name when that name is free (for example
     `https://jordan-canvas-47600.usw2.devtunnels.ms`), otherwise it gets a random name. Tell the
     user the link shows that name.
   - **The moment that appears, post the link and the QR code in chat.** Attach the QR image: copy
     `<path>` (`phone-qr.svg` in `~/.copilot/canvas-runtime/copilot-canvas/`) into your session files
     and attach it. If you cannot attach images, paste the printed QR exactly as printed in a plain
     code block. Ask the user to scan it and sign in. Don't wait for the rest of setup: the phone
     shows "Not connected" and reconnects on its own once the canvas is open.
   - Once the canvas is open, its **Open on phone** button shows the same link and QR code. If the
     button is missing (the gateway started after the canvas opened), open the canvas again. Ask the
     user to send a message from the phone and confirm it arrives in this conversation.
   - Offer to install it on the phone: the canvas walks them through **Add to Home Screen** for their
     phone and browser, and it then opens like an app.
   - After icon changes, tell the user to delete the existing home-screen app and add it again
     (**Share → Add to Home Screen**): iOS snapshots the icon when the app is added.
   - Then offer notifications: in the installed app, tap the bell, **Turn on**, then **Send test**.
     Confirm the test arrives. Pushes carry no content. Later notifications stay quiet while the app
     is open in front; the bell has a switch to change that.

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
  is not registered, follow the registration bullet in Part 1 step 2, or tap the canvas's reload
  button (restarting the Copilot app also works).
- **The canvas shows another copy's changes:** another folder in `~/.copilot/extensions` has the same
  canvas id; remove it.
- **The phone link stopped working:** the computer slept or `npm run phone` stopped. Start it again.
- **A new panel works on desktop but is "Not found" on the phone:** the gateway reads its route list
  when `npm run phone` starts. Restart it after a change to `gateway/`, and make sure the canvas
  picked up the new build so the provider serves the new route too.
- **"Not connected" on the phone:** the canvas was closed. Open it again in Copilot, then refresh the
  phone.
- **Undo:** stop `npm run phone`; `devtunnel delete <tunnel-id>` (the id is in
  `~/.copilot/canvas-runtime/copilot-canvas/phone.json`); remove `~/.copilot/extensions/copilot-canvas`
  and `~/.copilot/canvas-runtime/copilot-canvas` (tunnel id, notification keys, subscriptions and
  setup progress); delete `<FOLDER>` and, if they want, their private repository
  (`gh repo delete <login>/copilot-canvas`, after they confirm). The profile, skills, agents and
  automations from Part 3 are not part of the canvas; they stay until the user removes them.
