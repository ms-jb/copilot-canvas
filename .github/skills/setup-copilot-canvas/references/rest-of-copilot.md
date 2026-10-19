# Set up the rest of Copilot

The canvas is one part. The rest is how Copilot works for them in every chat: who they are, how
they like to work, skills for tasks they repeat, their own agents, automations and dashboards. Do
one stage at a time. They make the decisions and supply the content in their own words; you ask,
draft from their answers, show the draft and write it only after they approve. Do not copy someone
else's files, including this repository maintainer's. Explain how each piece works, so they can
ask for the next one without this guide.

**For every stage:**

- Say in one or two sentences what it is and what they get. Choices: "Start (Recommended)",
  "Skip for now", "Stop here".
- Ask one question at a time, recommended option first. Use what you learned in
  [change-the-canvas.md](change-the-canvas.md).
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
   automation needs its own consent (see Ground rules in [SKILL.md](../SKILL.md)). Start read-only
   and manual: draft it with
   `save_workflow` (`interval: "manual"`, `user_confirmation: "dialog"`) so the user reviews and saves
   it. Say which project, data and actions it can use. With their approval, run it once and read the
   result together. Add a schedule only after a separate yes. Each run is a new session in the app;
   it does not show in this phone conversation.
6. **A dashboard** in the canvas. Turn something they track into a panel with a chart: open pull
   requests by age, meetings per day, tasks done this week. Use a builder (see
   [change-the-canvas.md](change-the-canvas.md)) with `add-data-endpoint` and `add-view-or-panel`.
   Start with simple bars drawn in CSS or SVG; ask before adding a chart library. The data is
   read-only, and it shows on the phone only if its route is added to the gateway.
7. **Next changes.** Suggest a backup for `~/.copilot/copilot-instructions.md`, `skills/` and
   `agents/` (a private git repository or their cloud folder; never secrets). Offer a short weekly
   review: _"What did I repeat or correct this week?"_ Each answer can become a skill, a rule in their
   profile or a panel. Remind them they can ask from any chat, and that the canvas's empty right-hand
   side has ideas.
