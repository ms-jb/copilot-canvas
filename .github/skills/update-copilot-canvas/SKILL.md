---
name: update-copilot-canvas
description: "Update the user's own copy of Copilot Canvas / Copilot Companion from the upstream template ms-jb/copilot-companion: check what is new, explain it in plain language, apply it on a branch with their customizations kept, verify, then ask before merging and installing. Use for 'update my Copilot Canvas from upstream', 'get the latest template', 'is there an update', or a scheduled check."
---

# Update from upstream

This is the playbook Copilot follows when the user says _"Update my Copilot Canvas from upstream with
the update-copilot-canvas skill"_, or when a scheduled check tells them there is news. The user's copy
was made from the template and has no shared git history with it, so this is **not** a `git merge`
of `upstream/main` (that would conflict on every file). `scripts/upstream-sync.mts` does the
bookkeeping instead: `.template-sync.json` names the upstream commit the copy was last synced to, and
every file upstream changed since is compared with that old version.

**For Copilot.** Work in the user's copy (see `customization-workflow` section 1 for finding it) and
read `AGENTS.md` first. Never discard the user's changes, never force-push, never touch secrets or
the tunnel. Ask before each step that changes something outside a branch: merging, installing,
restarting. Use plain language; keep commands out of chat unless asked.

## Check only (also the scheduled mode)

1. `node scripts/upstream-sync.mts check --json` from the copy. It adds a fetch-only `upstream`
   remote (push disabled) if missing, fetches, and prints a report. Exit code 10 means updates,
   0 up to date, 1 an error. It changes nothing else.
2. `state: "unknown-base"`: the copy has no `.template-sync.json` (made before this skill existed,
   or the file was lost). Run `node scripts/upstream-sync.mts guess`: it ranks upstream commits by how
   many files still match the copy. Take the first when it is clearly best (far fewer differing files
   than the rest). Say which commit and why; if it is close, ask the user. Then
   `node scripts/upstream-sync.mts record --sha <commit>` and check again.
3. Tell the user what changed, grouped, in plain language, not as a commit list:
   - **New things you can use** (features, shortcuts, notifications, speed).
   - **Fixes.**
   - **Behind the scenes** (tests, docs, tooling).
     Use `commits[].subject` and `areas`; read a commit's diff only when its subject is not enough.
     Mention how many of their files are affected, in the kinds below.
4. In **check only** mode (a scheduled run, or "just tell me"), stop here. Never apply anything, and
   notify at most: `node scripts/upstream-sync.mts check --notify` pushes one line to their phone
   when there is news. See [references/recurring-check.md](references/recurring-check.md).

## What the report means

Each changed file is one of:

- **untouched** (`untouched`): the copy still has upstream's old version. The new one is taken.
- **changed by you** (`changed-by-you`): the copy edited it too. It is merged three ways (old
  upstream, yours, new upstream). Anything that overlaps is left as conflict markers for you to
  resolve with them; a file upstream deleted that you changed is kept; a file you deleted stays
  deleted.
- **personalization** (`protected`): `template.config.json`, `.template-sync.json`, and
  `ui/public/assets/` (icons and branding). Never overwritten. Say if upstream changed one so the user
  can decide whether to copy a change over by hand.
- **built output** (`generated`): `extension/` and the lock file. Never merged; the build makes them.

`restartGateway` means `gateway/` or `src/shared/` changed, `rebuild` means more than documentation
changed, and `install` means `package.json` changed.

## Apply

Only after the user says yes to the summary.

1. Work on a branch, so nothing of theirs is at risk. The working tree must be clean: if it is not,
   show `git status --short` and ask whether to commit their work first. Never stash or reset it.
2. `node scripts/upstream-sync.mts apply --json`. It creates `update-from-upstream-<date>-<sha>`,
   applies the files above, updates `.template-sync.json` and commits when nothing conflicts.
3. **Conflicts** (`conflicts` is not empty, nothing committed): open each file, which shows
   `<<<<<<< yours`, `=======` and `>>>>>>> new upstream`. Keep what the user customized and take what
   upstream added; when both matter, combine them. If a choice is theirs to make (their wording
   against a new behavior), ask with both options shown. Then `git add -A` and commit.
4. Run, in the copy: `npm install` when `install` is true, then `npx vp check`, `npx vp test` and
   `npm run build`. Fix failures caused by the merge, which usually means a conflict resolved
   half-way or a customization that used something upstream moved. Report anything unrelated.
   Commit the rebuilt `extension/` with the update.
5. Show the summary: what changed, what was merged around their edits, what was left alone, the
   check results.

## Finish

Ask before each of these, one at a time:

1. **Merge to their main:** `git switch main`, `git merge --ff-only <branch>` (or a normal merge if
   main moved). Never rewrite history or force-push. Pushing is their call; ask, and remember
   the copy's `origin` is their own private repository.
2. **Install:** `npm run install-ext` builds again and swaps their build in; the open canvas
   reloads itself. Remind them to tap **Reload extensions** if it still shows the old version.
3. **Phone gateway:** only if `restartGateway` is true, tell them the running gateway keeps its old
   code, and ask before restarting `npm run devtunnel` (it reuses the same tunnel and link).

If they decline the merge, leave the branch for later and say its name. To undo before merging,
`git switch main` and delete the branch; main was never touched. `.template-sync.json` only moves
forward on the branch that was merged.

## Don't

- Don't run `git merge upstream/main`, `git pull upstream`, `git rebase` onto upstream or
  `git push upstream` (its push URL is disabled on purpose).
- Don't overwrite personalization, hand-edit `extension/`, or resolve a conflict by dropping the
  user's side without asking.
- Don't install, restart or merge without the user's yes, and don't schedule anything on their
  behalf: that is the setup skill's optional last stage, asked first.
