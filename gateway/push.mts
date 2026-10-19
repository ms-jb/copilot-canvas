// Stable entry point for phone notifications. Pushes carry no conversation payload.
export { isAllowedPushEndpoint, vapidAuthorization, sendPush } from "./push/web-push.mts";
export type { PushSender } from "./push/web-push.mts";
export { openPushStore } from "./push/store.mts";
export type { PushStore } from "./push/store.mts";
export { createPresence, createNotifier } from "./push/notifications.mts";
export type { Notice, Presence, Notifier, StreamSnapshot } from "./push/notifications.mts";
export { classifyAttention, LONG_TURN_MS } from "./push/attention.mts";
export type { Attention, AttentionEvent, AttentionKind } from "./push/attention.mts";
export { parseSse } from "./streams/sse.mts";
