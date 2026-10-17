import { LIMITS } from "../../extension-src/shared/contract.mts";
import { createNotifier, createPresence } from "../push/notifications.mts";
import type { Notice } from "../push/notifications.mts";
import { openPushStore } from "../push/store.mts";
import type { PushSender } from "../push/web-push.mts";

export interface PushOptions {
  statePath: string;
  assistantName: string;
  sender?: PushSender;
}

export function createPushState(options: PushOptions) {
  return {
    store: openPushStore(options.statePath, options.sender),
    notifier: createNotifier(options.assistantName),
    presence: createPresence(LIMITS.pushPresenceTtlMs),
    fallback: { title: options.assistantName, body: "Open the canvas to see what's new." },
    latest: null as Notice | null,
  };
}

export type PushState = ReturnType<typeof createPushState>;
