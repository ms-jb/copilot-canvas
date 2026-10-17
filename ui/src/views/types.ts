import type { ComponentType } from "react";
import type { Connection } from "../useConnection";

/** Props every view receives. Views read the shared connection; they never open their own. */
export interface ViewProps {
  connection: Connection;
}

export interface ViewDefinition {
  /** Used in the URL hash (`#/<id>`), so keep it short and URL-safe. */
  id: string;
  title: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType<ViewProps>;
}
