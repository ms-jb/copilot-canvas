import { useEffect, useState } from "react";
import type { Connection } from "../useConnection";
import type { ViewDefinition } from "../views/types";
import classes from "./ViewStack.module.css";

/** Renders the active view. Visited views stay mounted (hidden) so drafts and scroll survive. */
export function ViewStack({
  views,
  activeId,
  connection,
}: {
  views: ViewDefinition[];
  activeId: string | undefined;
  connection: Connection;
}) {
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (activeId)
      setVisited((current) => (current.has(activeId) ? current : new Set(current).add(activeId)));
  }, [activeId]);

  return (
    <>
      {views.map((view) =>
        visited.has(view.id) || view.id === activeId ? (
          <div key={view.id} className={classes.pane} hidden={view.id !== activeId}>
            <view.component connection={connection} />
          </div>
        ) : null,
      )}
    </>
  );
}
