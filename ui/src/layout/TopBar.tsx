import { Indicator } from "@mantine/core";
import { InstallApp } from "../components/share/InstallApp";
import { Notifications } from "../components/share/Notifications";
import { OpenOnPhone } from "../components/share/OpenOnPhone";
import { ReloadExtensions } from "../components/share/ReloadExtensions";
import type { Connection } from "../useConnection";
import { unreadLabel } from "../features/unread/model";
import { useUnread } from "../features/unread/useUnread";
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
  // The sidebar holds the Chat link and its count; while it is out of sight the count shows here.
  const unread = useUnread().chat;
  const unreadHere = !sidebarOpen && unread > 0;
  const toggleLabel = phone ? "Open navigation" : sidebarOpen ? "Hide sidebar" : "Show sidebar";
  return (
    <header className={classes.topBar}>
      <IconButton
        label={unreadHere ? `${toggleLabel}, ${unreadLabel(unread)}` : toggleLabel}
        onClick={props.onToggleSidebar}
        expanded={sidebarOpen}
        controls={SIDEBAR_ID}
      >
        <Indicator
          disabled={!unreadHere}
          label={unread > 99 ? "99+" : unread}
          size={16}
          offset={2}
          inline
          processing={false}
        >
          {phone ? <MenuIcon /> : <SidebarIcon />}
        </Indicator>
      </IconButton>
      <h1 className={classes.title}>{title}</h1>
      <div className={classes.actions}>
        <OpenOnPhone connection={connection} />
        <InstallApp />
        <Notifications assistantName={connection.config?.assistantName ?? "Copilot"} />
        <ReloadExtensions connection={connection} />
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
