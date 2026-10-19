import { suggestPrompt } from "../../composerDraft";
import { AddPanelIcon } from "../icons";
import classes from "./AddPanelCard.module.css";

const SETUP_URL =
  "https://github.com/ms-jb/copilot-companion/blob/main/.github/skills/setup-copilot-companion/SKILL.md";

// Short labels on the chips; the prompt they fill names the source, so Copilot edits this canvas
// instead of opening a native app panel.
const SUGGESTIONS = [
  { label: "My open pull requests", ask: "a panel that lists my open pull requests" },
  { label: "Today's agenda", ask: "a panel with today's agenda" },
  { label: "A scratchpad for notes", ask: "a scratchpad panel for quick notes that I can edit" },
];

function buildPrompt(ask: string, sourceDir: string | undefined): string {
  const where = sourceDir
    ? `my Copilot Companion source at ${sourceDir}`
    : `my Copilot Companion copy (if I don't have one yet, set it up first with ${SETUP_URL})`;
  return (
    `In ${where}, add ${ask} to the canvas's right-hand aside. Change the canvas code itself ` +
    "(see ui/src/views/registry.ts and AGENTS.md), then rebuild and reinstall it. Don't open a " +
    "native app panel instead."
  );
}

/** Empty state for the aside: invites the user to ask Copilot to add a panel to their canvas. */
export function AddPanelCard({ sourceDir, onPick }: { sourceDir?: string; onPick?: () => void }) {
  return (
    <div className={classes.card}>
      <span className={classes.icon} aria-hidden="true">
        <AddPanelIcon size={18} />
      </span>
      <p className={classes.title}>Make this space yours</p>
      <p className={classes.body}>
        Ask Copilot to add a panel here, then keep tweaking. Try one of these:
      </p>
      <div className={classes.prompts}>
        {SUGGESTIONS.map(({ label, ask }) => (
          <button
            key={label}
            type="button"
            className={classes.prompt}
            onClick={() => {
              suggestPrompt(buildPrompt(ask, sourceDir));
              onPick?.();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
