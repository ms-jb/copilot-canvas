import type { ComponentType } from "react";
import type { Connection } from "../useConnection";

/** Props every view and aside panel receives. They read the shared connection; they never open their own. */
export interface ViewProps {
  connection: Connection;
}

/** A destination in the sidebar navigation, rendered in the center column. */
export interface ViewDefinition {
  /** Used in the URL hash (`#/<id>`), so keep it short and URL-safe. */
  id: string;
  title: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType<ViewProps>;
}

/** A section of the right-hand aside, shown next to every view. */
export interface AsidePanelDefinition {
  /** Unique and stable; used as the section's DOM id. */
  id: string;
  title: string;
  component: ComponentType<ViewProps>;
}
