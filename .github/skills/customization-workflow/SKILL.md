---
name: customization-workflow
description: "Use for 'make this canvas mine', choosing the next customization, or delivering a canvas change. Scope one step and carry it through checks, installation and verification."
---

# Customize the user's canvas

Read `AGENTS.md`. Use this skill for the shared customization process, not as a
replacement for the implementation skills:

- `add-view-or-panel`: sidebar destinations and aside content.
- `add-data-endpoint`: outside data through read-only host endpoints.
- `theme-and-identity`: names, default view, theme tokens and phone branding.

## 1. Work in the user's copy

- Read `SETUP.md` if the user has not installed a copy yet. Follow its consent
  and setup steps rather than treating the template checkout as their copy.
- If setup already selected a folder, keep working there in this conversation.
  A `PanelConfig.sourceDir` hint can help locate it, but verify the checkout:
  `src/shared/node/config.mts` documents that the install hint can be stale.
- Inspect `git status --short` and `git remote -v` before editing. Preserve
  unrelated work. Change source files in that copy, not a downloaded install.
- **Guide in the user's conversation; let a builder write the code.** The
  conversation the user talks to (often the canvas's own) keeps asking, guiding
  and approving, so the user never waits on a build. It hands sections 3 and
  4.2 to a background `task` agent in the same conversation, whose permission
  requests then still reach the phone. The conversation keeps the rest: user
  questions, `npm run install-ext`, reopening the canvas, the installed check and
  the commit. One builder at a time per copy. Small configuration edits (a name
  in `template.config.json`) need no builder. `SETUP.md` Part 2 has the brief.
- **If you are the builder,** do only sections 3 and 4.2, then report the changed
  files, check results and what the user should see. Do not install, commit,
  push, start other agents or ask the user; stop and report any decision you need.

## 2. Pick one useful step

- If the request is already specific, implement it without restarting an
  interview. Otherwise ask one short question at a time, recommended option first.
- Ask what they want at a glance, what to call the assistant, and what is
  off-limits, only as needed. Prefer a few concrete choices over an open questionnaire.
- Offer optional read-only calendar or GitHub activity discovery only when it
  would help choose a customization. Ask before collecting it; use aggregates
  rather than putting private records into source or preview fixtures.
- Describe the smallest useful result and how the user will verify it. For
  example: a compact open-PR list first, filtering later.
- State data scope, storage behavior and phone availability for that result.
  A local scratchpad must not be described as synchronized across devices.
- Ask separately before installing software, publishing remotely, using paid
  services or scheduling automation that the current consent did not cover.
- Keep progress messages short and describe what the user will see. Put commands
  in chat only when the user needs them or asks for them.

## 3. Implement through the matching skill

- Read the relevant source and follow its current types. Use Mantine, CSS modules,
  `--cc-*` tokens and erasable TypeScript; no enums or namespaces.
- Keep the first change small enough to demonstrate. Preserve chat, prompts,
  settings, reconnect behavior and the owner's existing customizations.
- Add a test for new logic under `tests/`; update directly affected user-facing
  documentation when behavior changes. Use synthetic data in the dev preview.

## 4. Check, install, verify

Run commands from the user's copy with Node.js 22.18+ and the platform's shell.
Respect explicit task limits if the user requested source-only work.

1. Preview with `npx vp dev`. Use the relevant states listed in `README.md` and
   inspect desktop and phone layouts. A preview uses a mock, not a live session.
2. Run `npx vp check` and `npx vp test` for the affected tests. Fix failures
   caused by the change and report unrelated failures accurately.
3. Run `npm run install-ext`. It builds and installs this copy; a successful
   build alone does not prove installation or that a running canvas changed.
4. The open canvas reloads itself onto the new build a few seconds after
   `install-ext`. Wait about five seconds, then `open_canvas` again (same
   `instanceId`); on the phone, a page refresh picks it up. Ask the user to tap
   **Reload extensions** only when the canvas still shows an older build that
   predates self-reload. Never answer a permission prompt or change session mode.
5. Verify the requested behavior in the installed canvas. For phone features,
   have the user check the phone too. If it says **Not connected**, follow
   `SETUP.md`: the desktop canvas must be open and phone hosting must be running.
   If the change touched `gateway/`, restart `npm run phone` first; the running
   gateway keeps the code it started with.
6. Report what was observed. If a phone check is still pending, say so; do not
   mark it verified on the strength of a screenshot from dev mode.

`extension/` is generated and committed for link installs. `npx vp build` builds
the UI and invokes `syncExtension` through `vite.config.ts`.
`npm run sync-ext` rebuilds the host/config only, preserving the built UI;
it is not a substitute for a UI build. Never hand-edit generated output.

## 5. Preserve and hand over the change

- Unless the user restricted git writes, commit the intended source changes
  together with the rebuilt `extension/` after verification. Inspect the diff
  first; do not include unrelated files or private data.
- Ask before pushing. Check the remote again: the user's copy should be their
  own private repository made from the template (`SETUP.md` step 1). If `origin`
  is `ms-jb/copilot-canvas` and the user does not own it, never push there. With
  their approval, run `git remote remove origin` and
  `gh repo create --private --source . --push`, then verify the remotes.
- Finish with the change, verification result and any remaining human step.
  Suggest one or two small next tweaks based on what the user chose. During
  setup, return to the `SETUP.md` Part 3 stage where the user stopped.

## Don't

- Do not open native app panels, My work tabs or another canvas instead of editing this app.
- Do not auto-answer permissions, questions or plans; require explicit user taps.
- Do not bind servers beyond `127.0.0.1`, relax owner-only tunnel access, or
  weaken CSRF, generation and session checks in `src/host/server.mts`.
- Do not put secrets in the repo, `template.config.json`, generated output or chat.
- Do not add heavy dependencies or use `install-ext --force` to overwrite an
  unrelated extension. Explain the conflict and get the user's decision instead.
