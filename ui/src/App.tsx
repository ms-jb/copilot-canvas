import { useEffect, useState } from "react";
import { LoadingSkeleton } from "./layout/LoadingSkeleton";
import { Shell } from "./layout/Shell";
import { ViewStack } from "./layout/ViewStack";
import { useConnection } from "./useConnection";
import { views } from "./views/registry";

// Shown until the bootstrap delivers the configured assistantName.
const DEFAULT_NAME = "Copilot";

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
  const assistantName = connection.config?.assistantName || DEFAULT_NAME;

  const activeView =
    views.find((view) => view.id === hashId) ??
    views.find((view) => view.id === connection.config?.defaultView) ??
    views[0];

  useEffect(() => {
    document.title = assistantName;
  }, [assistantName]);

  return (
    <Shell
      connection={connection}
      title={activeView?.title ?? assistantName}
      activeViewId={activeView?.id}
    >
      {connection.config ? (
        <ViewStack views={views} activeId={activeView?.id} connection={connection} />
      ) : (
        <LoadingSkeleton />
      )}
    </Shell>
  );
}
