import { suggestPrompt } from "../../composerDraft";
import { AddPanelIcon } from "../icons";
import classes from "./AddPanelCard.module.css";

const SUGGESTIONS = [
  "Add a panel here that shows my open pull requests",
  "Show today's agenda in this space",
  "Pin a scratchpad for quick notes here",
];

/** Empty state for the aside: invites the user to ask Copilot for a panel, never to edit files. */
export function AddPanelCard({ onPick }: { onPick?: () => void }) {
  return (
    <div className={classes.card}>
      <span className={classes.icon} aria-hidden="true">
        <AddPanelIcon size={18} />
      </span>
      <p className={classes.title}>Make this space yours</p>
      <p className={classes.body}>Ask Copilot to add a panel here. For example:</p>
      <div className={classes.prompts}>
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            className={classes.prompt}
            onClick={() => {
              suggestPrompt(text);
              onPick?.();
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
