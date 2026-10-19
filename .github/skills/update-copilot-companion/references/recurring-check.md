# Recurring update check

A weekly check that **only tells the user there is news**. It never merges, installs or restarts
anything; applying an update is always the user saying yes in a chat (see [SKILL.md](../SKILL.md)).
Offer it, ask first, and never set it up silently.

## The command

From the user's copy folder (`<FOLDER>`):

```sh
node scripts/upstream-sync.mts check --notify
```

It fetches the template (adding the fetch-only `upstream` remote on the first run), prints what is
new, and, when there is news, pushes one line to their phone ("Updates available") through the
running gateway. Exit code 10 means updates, 0 up to date, 1 an error. If the gateway is down the
notice is skipped quietly and the command still reports. It touches no files in the copy.

## Pick one scheduler, with their yes

Prefer what they already use. Run it weekly, for example Monday at 09:00, and say the time you chose.

1. **A scheduled Copilot task** (the Copilot app's Automations or the CLI's schedule): a prompt that
   runs the command above in `<FOLDER>` and reports the result. Save it with a confirmation dialog,
   run it once together, then add the schedule after a separate yes. A run that finds updates says
   so in one line and applies nothing.
2. **macOS (launchd)**: a user agent in `~/Library/LaunchAgents/` that runs
   `/bin/sh -c 'cd <FOLDER> && node scripts/upstream-sync.mts check --notify'` with a
   `StartCalendarInterval` of `Weekday` 1, `Hour` 9. Load it with `launchctl load`.
3. **Linux (systemd user timer)**: a `.service` running the same `cd <FOLDER> && node ...` line and a
   `.timer` with `OnCalendar=Mon 09:00` and `Persistent=true`; `systemctl --user enable --now`.
   Cron works too: `0 9 * * 1 cd <FOLDER> && node scripts/upstream-sync.mts check --notify`.
4. **Windows (Task Scheduler)**:
   `schtasks /Create /SC WEEKLY /D MON /ST 09:00 /TN "Copilot Companion update check" /TR "cmd /c cd /d <FOLDER> && node scripts\upstream-sync.mts check --notify"`.

Use `<FOLDER>` and the full path to `node` where the scheduler has a short `PATH`. Check it by running
the scheduled job once now and reading the result.

## Undo

Say how: the scheduled task's own delete or disable, `launchctl unload` and remove the file,
`systemctl --user disable --now` and remove the units (or the cron line), or
`schtasks /Delete /TN "Copilot Companion update check" /F`. The `upstream` remote can stay (its push is
disabled); `git remote remove upstream` removes it.
