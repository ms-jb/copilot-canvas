import { Skeleton } from "@mantine/core";
import type { Connection } from "../useConnection";
import { CloseIcon } from "../views/icons";
import { views } from "../views/registry";
import { ConnectionDot } from "./ConnectionDot";
import { IconButton } from "./IconButton";
import classes from "./Sidebar.module.css";

interface SidebarProps {
  connection: Connection;
  activeViewId: string | undefined;
  /** Called after a navigation link is followed (closes the phone drawer). */
  onNavigate?: () => void;
  /** When set, a close button is shown in the brand row (drawer mode). */
  onClose?: () => void;
}

export function Sidebar({ connection, activeViewId, onNavigate, onClose }: SidebarProps) {
  const name = connection.config?.assistantName;

  return (
    <div className={classes.sidebar}>
      <div className={classes.brand}>
        <span className={classes.mark} aria-hidden="true">
          {name?.trim().charAt(0).toUpperCase() ?? ""}
        </span>
        {name ? (
          <span className={classes.name} title={name}>
            {name}
          </span>
        ) : (
          <Skeleton height={12} width={88} radius="sm" />
        )}
        <ConnectionDot phase={connection.phase} />
        {onClose && (
          <span className={classes.close}>
            <IconButton label="Close navigation" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </span>
        )}
      </div>

      <nav aria-label="Views" className={classes.nav}>
        <ul className={classes.navList}>
          {views.map((view) => (
            <li key={view.id}>
              <a
                href={`#/${view.id}`}
                className={classes.navLink}
                aria-current={view.id === activeViewId ? "page" : undefined}
                onClick={onNavigate}
              >
                <view.icon size={18} />
                <span>{view.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
