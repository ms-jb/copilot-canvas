import { Drawer } from "@mantine/core";
import { useEffect, useState, type ReactNode } from "react";
import { ConnectionBanner } from "../components/ConnectionBanner";
import type { Connection } from "../useConnection";
import { Aside } from "./Aside";
import classes from "./Shell.module.css";
import { Sidebar } from "./Sidebar";
import { ASIDE_ID, SIDEBAR_ID, TopBar } from "./TopBar";
import { useLayoutMode } from "./useLayoutMode";
import { usePersistentFlag } from "./usePersistentFlag";

interface ShellProps {
  connection: Connection;
  title: string;
  activeViewId: string | undefined;
  children: ReactNode;
}

type DrawerName = "sidebar" | "aside" | null;

/**
 * Three columns: sidebar, the active view, and the aside.
 *
 * Desktop (> 1100px): both side columns are toggleable and remembered.
 * Tablet (769-1100px): the sidebar stays a column; the aside opens as a drawer.
 * Phone (<= 768px): one column; sidebar and aside both open as drawers.
 */
export function Shell({ connection, title, activeViewId, children }: ShellProps) {
  const mode = useLayoutMode();
  const [sidebarPinned, setSidebarPinned] = usePersistentFlag("sidebar-open", true);
  const [asidePinned, setAsidePinned] = usePersistentFlag("aside-open", true);
  const [drawer, setDrawer] = useState<DrawerName>(null);

  useEffect(() => setDrawer(null), [mode]);

  const sidebarIsColumn = mode !== "phone";
  const asideIsColumn = mode === "desktop";
  const sidebarOpen = sidebarIsColumn ? sidebarPinned : drawer === "sidebar";
  const asideOpen = asideIsColumn ? asidePinned : drawer === "aside";
  const closeDrawer = () => setDrawer(null);
  const toggleDrawer = (name: DrawerName) => setDrawer((open) => (open === name ? null : name));

  return (
    <div className={classes.shell}>
      {sidebarIsColumn && sidebarPinned && (
        <div className={classes.sidebarColumn} id={SIDEBAR_ID}>
          <Sidebar connection={connection} activeViewId={activeViewId} />
        </div>
      )}

      <div className={classes.center}>
        <TopBar
          connection={connection}
          title={title}
          mode={mode}
          sidebarOpen={sidebarOpen}
          asideOpen={asideOpen}
          onToggleSidebar={() =>
            sidebarIsColumn ? setSidebarPinned(!sidebarPinned) : toggleDrawer("sidebar")
          }
          onToggleAside={() =>
            asideIsColumn ? setAsidePinned(!asidePinned) : toggleDrawer("aside")
          }
        />
        <ConnectionBanner phase={connection.phase} />
        <main className={classes.main}>{children}</main>
      </div>

      {asideIsColumn && asidePinned && (
        <aside className={classes.asideColumn} id={ASIDE_ID} aria-label="Details">
          <Aside connection={connection} />
        </aside>
      )}

      {!sidebarIsColumn && (
        <ShellDrawer
          id={SIDEBAR_ID}
          label="Navigation"
          position="left"
          opened={drawer === "sidebar"}
          onClose={closeDrawer}
        >
          <Sidebar
            connection={connection}
            activeViewId={activeViewId}
            onNavigate={closeDrawer}
            onClose={closeDrawer}
          />
        </ShellDrawer>
      )}

      {!asideIsColumn && (
        <ShellDrawer
          id={ASIDE_ID}
          label="Details"
          position="right"
          opened={drawer === "aside"}
          onClose={closeDrawer}
        >
          <Aside connection={connection} onClose={closeDrawer} />
        </ShellDrawer>
      )}
    </div>
  );
}

interface ShellDrawerProps {
  id: string;
  label: string;
  position: "left" | "right";
  opened: boolean;
  onClose: () => void;
  children: ReactNode;
}

function ShellDrawer({ id, label, position, opened, onClose, children }: ShellDrawerProps) {
  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position={position}
      size={position === "left" ? 280 : 340}
      classNames={{ content: classes.drawer, body: classes.drawerBody }}
      transitionProps={{ duration: 200, timingFunction: "cubic-bezier(.2,.8,.2,1)" }}
    >
      <Drawer.Overlay backgroundOpacity={0.32} />
      <Drawer.Content id={id} aria-label={label}>
        <Drawer.Body>{children}</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
