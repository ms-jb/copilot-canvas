# Set up Copilot Canvas

This is the setup playbook Copilot follows when you click **Install in GitHub Copilot** (or paste
_"Set up Copilot Canvas by following https://github.com/ms-jb/copilot-canvas/blob/main/SETUP.md"_
into any Copilot chat). You don't need to run any of it yourself.

---

**For Copilot.** Get the user from this page to a canvas they own, on desktop and on their phone,
in about five minutes. Then help them make it theirs (Part 2) and walk them through building the
rest of their Copilot setup (Part 3), while a builder writes the code in the background. Use the
platform's shell and paths (Windows or macOS).

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
3. **Phone** (skip if they chose to). Start this as soon as `npm install` finishes, alongside step 2,
   so the user can move to their phone early:
   - Install the dev tunnel CLI if missing (`winget install Microsoft.devtunnel`,
     `brew install --cask devtunnel`).
   - If `devtunnel user show` is not signed in, run `devtunnel user login -d` and show the device code and
     link. The user finishes it in a browser with the account they will use on their phone.
   - In `<FOLDER>`, start `npm run phone` with `NO_COLOR=1` as a long-lived, detached background
     process. It creates or reuses their owner-only tunnel, refuses one with extra access, hosts it and
     starts the gateway, then prints `Open on phone: <link>` and a QR code.
   - **The moment that appears, post the link and the QR code in chat** (the QR exactly as printed, in a
     plain code block) and ask the user to scan it and sign in. Don't wait for the rest of setup: the
     phone shows "Not connected" and reconnects on its own once the canvas is open.
   - Once the canvas is open, reopen it so its **Open on phone** button appears, and ask the user to
     send a message from the phone. Confirm it arrives in this conversation.
   - Offer to install it on the phone: the canvas walks them through **Add to Home Screen** for their
     phone and browser, and it then opens like an app.
   - Then offer notifications: in the installed app, tap the bell, **Turn on**, then **Send test**.
     Confirm the test arrives. Pushes carry no content. Later notifications stay quiet while the app
     is open in front; the bell has a switch to change that.

## Part 2: Make it yours

From here, this conversation is the guide and a builder writes the code. The user keeps answering
questions and making choices while a build runs; they never wait on code.

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

   Run one builder at a time: builders share `<FOLDER>` and the installed canvas. Keep a list of the
   next canvas ideas instead. A one-line change to `template.config.json` (name, first view) needs no
   builder. If the user is at the computer and wants to watch the build in its own chat, offer a
   nested session instead: register `<FOLDER>` with `create_project`, then `create_session` for that
   project with `workspace_type: "branch"`, so it edits `<FOLDER>` and not a separate worktree. Tell
   them its permission requests show in that session on the computer, not on the phone.

3. **Start Part 3 at once.** Don't wait for the build.
4. **When the builder reports,** let the user finish the current question, then pause the journey:
   - If the builder stopped with a question, ask the user, then start a new builder with the answer.
   - Otherwise read the diff, run `npm run install-ext` in `<FOLDER>`, and ask the user to tap
     **Reload extensions** (the circular arrow in the canvas's top bar; it works on the phone too).
   - When they confirm they see the change, commit in `<FOLDER>` (source and the rebuilt
     `extension/`), suggest one next canvas idea, and go back to the journey where it stopped.

## Part 3: Grow your setup

The canvas is one part. The rest is how Copilot works for them in every chat: who they are, how
they like to work, skills for tasks they repeat, their own agents, automations and dashboards. Walk
them through it one stage at a time. They make the decisions and supply the content in their own
words; you ask, draft from their answers, show the draft and write it only after they approve. Do
not copy someone else's files, including this repository maintainer's. The goal is that they learn
how each piece works and can ask for the next one on their own.

**For every stage:**

- Say in one or two sentences what it is and what they get. Choices: "Start (Recommended)",
  "Skip for now", "Stop here".
- Ask one question at a time, recommended option first. Use what you learned in Part 2.
- Before you write a file, read what is already there. Show the merged result and keep their
  existing content. Say that personal files apply to every project, not only this one.
- Check that it works; each stage says how. If it loads only in a new chat, say so and check there.
- End with the one sentence they can use to do it again, for example _"Next time, say: make a
  skill for my weekly status note."_
- Keep progress in `~/.copilot/canvas-runtime/copilot-canvas/journey.md`: stages done or skipped,
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
   chat, ask for the task in their usual words and confirm Copilot uses the skill. Teach the habit:
   _"When you correct me twice on the same thing, ask me to make it a skill."_
4. **Their own agent** (`~/.copilot/agents/<name>.agent.md`). An agent is a specialist with its own
   instructions that Copilot can give a task to: a reviewer, a researcher, a writer in their style.
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
7. **Keep it growing.** Suggest a backup for `~/.copilot/copilot-instructions.md`, `skills/` and
   `agents/` (a private git repository or their cloud folder; never secrets). Offer a short weekly
   review: _"What did I repeat or correct this week?"_ Each answer can become a skill, a rule in their
   profile or a panel. Remind them they can ask from any chat, and that the canvas's empty right-hand
   side has ideas.

## Troubleshooting

- **The canvas is missing:** run `npm run install-ext`, then reload extensions (the canvas's reload
  button, or restart the Copilot app).
- **The canvas shows another copy's changes:** another folder in `~/.copilot/extensions` has the same
  canvas id; remove it.
- **The phone link stopped working:** the computer slept or `npm run phone` stopped. Start it again.
- **"Not connected" on the phone:** the canvas was closed. Open it again in Copilot, then refresh the
  phone.
- **Undo:** stop `npm run phone`; `devtunnel delete <tunnel-id>` (the id is in
  `~/.copilot/canvas-runtime/copilot-canvas/phone.json`); remove `~/.copilot/extensions/copilot-canvas`
  and `~/.copilot/canvas-runtime/copilot-canvas` (tunnel id, notification keys, subscriptions and
  journey progress); delete `<FOLDER>`. The profile, skills, agents and automations from Part 3 are
  not part of the canvas; they stay until the user removes them.
