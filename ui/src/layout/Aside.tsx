import type { Connection } from "../useConnection";
import { CloseIcon } from "../views/icons";
import { AddPanelCard } from "../views/panels/AddPanelCard";
import { asidePanels } from "../views/registry";
import classes from "./Aside.module.css";
import { IconButton } from "./IconButton";

interface AsideProps {
  connection: Connection;
  /** When set, the header shows a close button (drawer mode). */
  onClose?: () => void;
}

export function Aside({ connection, onClose }: AsideProps) {
  return (
    <div className={classes.aside}>
      <div className={classes.header}>
        <span className={classes.heading}>Details</span>
        {onClose && (
          <IconButton label="Close details" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </div>
      <div className={classes.body}>
        {asidePanels.map((panel) => (
          <section key={panel.id} className={classes.panel} aria-labelledby={`panel-${panel.id}`}>
            <h2 id={`panel-${panel.id}`} className={classes.panelTitle}>
              {panel.title}
            </h2>
            <panel.component connection={connection} />
          </section>
        ))}
        {asidePanels.length === 0 && (
          <AddPanelCard sourceDir={connection.config?.sourceDir} onPick={onClose} />
        )}
      </div>
    </div>
  );
}
