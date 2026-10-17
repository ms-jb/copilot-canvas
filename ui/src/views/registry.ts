import type { AsidePanelDefinition, ViewDefinition } from "./types";
import { ChatIcon } from "./icons";
import { ChatView } from "./ChatView";

export type { AsidePanelDefinition, ViewDefinition, ViewProps } from "./types";

/**
 * The views shown in the sidebar navigation, in order.
 *
 * To add a view:
 *   1. Create a component that takes `ViewProps` (see ChatView.tsx).
 *   2. Add an entry below with a unique `id`; it becomes reachable at `#/<id>`.
 *   3. Optionally set `defaultView` in template.config.json to open it first.
 */
export const views: ViewDefinition[] = [
  { id: "chat", title: "Chat", icon: ChatIcon, component: ChatView },
];

/**
 * The panels stacked in the right-hand aside, top to bottom. They stay visible next to every view.
 *
 * To add a panel:
 *   1. Create a component that takes `ViewProps` in `views/panels/`.
 *   2. Add an entry below with a unique `id` and a short `title`.
 * While the list is empty, the aside invites the user to ask Copilot for a panel.
 */
export const asidePanels: AsidePanelDefinition[] = [];
