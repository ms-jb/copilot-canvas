import type { ViewDefinition } from "./types";
import { ChatIcon } from "./icons";
import { ChatView } from "./ChatView";

export type { ViewDefinition, ViewProps } from "./types";

/**
 * The views shown in the navigation, in order.
 *
 * To add a view:
 *   1. Create a component that takes `ViewProps` (see ChatView.tsx).
 *   2. Add an entry below with a unique `id`; it becomes reachable at `#/<id>`.
 *   3. Optionally set `defaultView` in template.config.json to open it first.
 */
export const views: ViewDefinition[] = [
  { id: "chat", title: "Chat", icon: ChatIcon, component: ChatView },
];
