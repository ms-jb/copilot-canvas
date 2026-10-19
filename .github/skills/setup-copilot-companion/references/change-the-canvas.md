# Change the canvas

From here, this conversation asks the questions and a builder writes the code. The user keeps
answering questions and making choices while a build runs. `<FOLDER>` is their copy from Part 1 of
[SKILL.md](../SKILL.md).

1. **Ask what they do** in two or three one-tap questions (one at a time, recommended option first):
   what they want at a glance (open pull requests, today's agenda, a scratchpad, a checklist), what to
   call the assistant, and anything off-limits. If WorkIQ or `gh` is available, offer to look at the
   last few weeks of their calendar or GitHub activity (aggregates only, read-only) to suggest panels.
   Done when you have a request in their words.
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
   Done when the builder is running (or the one-line change is made) and the user knows what to expect.

3. **Start the rest of Copilot at once.** Don't wait for the build: read
   [rest-of-copilot.md](rest-of-copilot.md) and begin its first stage.
4. **When the builder reports,** let the user finish the current question, then stop the
   rest-of-Copilot stage:
   - If the builder stopped with a question, ask the user, then start a new builder with the answer.
   - Otherwise read the diff and run `npm run install-ext` in `<FOLDER>`. The open canvas reloads
     itself onto the new build; wait about five seconds, then `open_canvas` again (same
     `instanceId`). On the phone, a page refresh picks it up.
   - When they confirm they see the change, commit in `<FOLDER>` (source and the rebuilt
     `extension/`), suggest one next canvas idea, and continue the rest-of-Copilot stage where it
     stopped.

   Done when the user has confirmed the change in the reopened canvas and it is committed.
