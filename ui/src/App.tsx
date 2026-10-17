import { AppShell, Burger, NavLink, Title } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { useConnection } from "./useConnection";
import { views } from "./views/registry";

const MOBILE_MAX_WIDTH = 768;

function viewIdFromHash(hash: string): string | null {
  const match = /^#\/([A-Za-z0-9_-]+)/.exec(hash);
  return match?.[1] ?? null;
}

function useHashViewId(): string | null {
  const [id, setId] = useState(() => viewIdFromHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setId(viewIdFromHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return id;
}

export function App() {
  const connection = useConnection();
  const hashId = useHashViewId();
  const [navOpen, { toggle, close }] = useDisclosure(false);
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_MAX_WIDTH}px)`) ?? false;
  const title = connection.config?.displayName ?? "Chat Panel";

  const fallbackId = views.some((view) => view.id === connection.config?.defaultView)
    ? connection.config?.defaultView
    : views[0]?.id;
  const activeId = views.some((view) => view.id === hashId) ? hashId : fallbackId;

  // Views stay mounted once visited so drafts and scroll position survive navigation.
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (activeId)
      setVisited((current) => (current.has(activeId) ? current : new Set(current).add(activeId)));
  }, [activeId]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, close]);

  return (
    <AppShell
      padding={0}
      header={{ height: 52 }}
      navbar={{
        width: 220,
        breakpoint: `${MOBILE_MAX_WIDTH + 1}px`,
        collapsed: { mobile: !navOpen },
      }}
    >
      <AppShell.Header className="app-header">
        {isMobile && (
          <Burger
            opened={navOpen}
            onClick={toggle}
            size="sm"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            className="app-burger"
          />
        )}
        <Title order={1} size="h4" className="app-title">
          {title}
        </Title>
      </AppShell.Header>

      <AppShell.Navbar p="xs" aria-label="Views">
        {views.map((view) => (
          <NavLink
            key={view.id}
            href={`#/${view.id}`}
            label={view.title}
            leftSection={<view.icon />}
            active={view.id === activeId}
            onClick={close}
            className="nav-link"
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main className="app-main">
        <ConnectionBanner phase={connection.phase} />
        <div className="view-stack">
          {views.map((view) =>
            visited.has(view.id) || view.id === activeId ? (
              <div key={view.id} className="view-pane" hidden={view.id !== activeId}>
                <view.component connection={connection} />
              </div>
            ) : null,
          )}
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
