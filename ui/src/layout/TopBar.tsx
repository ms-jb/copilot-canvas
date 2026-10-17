import { OpenOnPhone } from "../components/share/OpenOnPhone";
import type { Connection } from "../useConnection";
import { AsideIcon, MenuIcon, SidebarIcon } from "../views/icons";
import { IconButton } from "./IconButton";
import classes from "./TopBar.module.css";
import type { LayoutMode } from "./useLayoutMode";

interface TopBarProps {
  connection: Connection;
  title: string;
  mode: LayoutMode;
  sidebarOpen: boolean;
  asideOpen: boolean;
  onToggleSidebar: () => void;
  onToggleAside: () => void;
}

export const SIDEBAR_ID = "cc-sidebar";
export const ASIDE_ID = "cc-aside";

export function TopBar(props: TopBarProps) {
  const { connection, title, mode, sidebarOpen, asideOpen } = props;
  const phone = mode === "phone";
  return (
    <header className={classes.topBar}>
      <IconButton
        label={phone ? "Open navigation" : sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
        expanded={sidebarOpen}
        controls={SIDEBAR_ID}
      >
        {phone ? <MenuIcon /> : <SidebarIcon />}
      </IconButton>
      <h1 className={classes.title}>{title}</h1>
      <div className={classes.actions}>
        <OpenOnPhone connection={connection} />
        <IconButton
          label={asideOpen ? "Hide details" : "Show details"}
          onClick={props.onToggleAside}
          expanded={asideOpen}
          controls={ASIDE_ID}
        >
          <AsideIcon />
        </IconButton>
      </div>
    </header>
  );
}
