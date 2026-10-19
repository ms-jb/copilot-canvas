import http from "node:http";
import { API, LIMITS, SSE_EVENTS } from "../../src/shared/contract.mts";
import type { ProviderState } from "../../src/shared/node/runtime-state.mts";
import type { Notice } from "../push/notifications.mts";
import { parseSse } from "../streams/sse.mts";
import type { SelectProvider } from "./provider-discovery.mts";
import type { PushState } from "./push-state.mts";
import { LOOPBACK } from "./request-policy.mts";

// How often to check the live provider, and how long a silent stream may stay open.
const PUSH_WATCH_MS = 2000;
const PUSH_STREAM_IDLE_MS = 45_000;

/**
 * Pushes one notice unless a subscribed device has the app open and focused (then the event is held
 * for every device), to the devices whose active hours allow it; only a blocker ignores those.
 * Resolves with how many devices the push service accepted for.
 */
export async function deliverNotice(
  push: Pick<PushState, "store" | "presence" | "latest">,
  notice: Notice | null,
): Promise<number> {
  if (!notice || push.presence.hasFocused()) return 0;
  push.latest = notice;
  return push.store.sendAll({
    skip: (endpoint) => push.presence.isFocused(endpoint),
    ignoreActiveHours: notice.tag === "blocker",
  });
}

export function watchPush(push: PushState, selectProvider: SelectProvider): () => void {
  let stream: { generation: string; request: http.ClientRequest } | null = null;

  const notify = (notice: Notice | null) => void deliverNotice(push, notice);

  function openStream(state: ProviderState) {
    const target = new URL(state.origin);
    const request = http.get({
      host: LOOPBACK,
      port: target.port,
      path: state.capabilityPath + API.events,
      agent: false,
      headers: { host: target.host, origin: target.origin, accept: "text/event-stream" },
      timeout: PUSH_STREAM_IDLE_MS,
    });
    stream = { generation: state.generation, request };
    const drop = () => {
      if (stream?.request === request) stream = null;
    };
    request.on("timeout", () => request.destroy());
    request.on("error", drop);
    request.on("close", drop);
    request.on("response", (reply) => {
      if (reply.statusCode !== 200) return request.destroy();
      let buffer = "";
      reply.setEncoding("utf8");
      reply.on("data", (chunk: string) => {
        const { frames, rest } = parseSse(buffer + chunk);
        buffer = rest.slice(-LIMITS.maxBodyBytes);
        for (const { event, data } of frames) {
          try {
            const value = JSON.parse(data);
            if (event === SSE_EVENTS.snapshot) {
              notify(push.notifier.snapshot(value.generation, value.snapshot));
            } else if (event === SSE_EVENTS.status) notify(push.notifier.status(value.status));
            else if (event === SSE_EVENTS.prompts) notify(push.notifier.prompts(value.prompts));
            else if (event === SSE_EVENTS.entry) notify(push.notifier.entry(value.entry));
          } catch {
            // A malformed frame is skipped; the next snapshot resynchronizes.
          }
        }
      });
    });
  }

  // Keep exactly one healthy stream to the live provider while anyone is subscribed.
  const watcher = setInterval(() => {
    if (push.store.endpoints().length === 0) {
      stream?.request.destroy();
      return;
    }
    void selectProvider().then((state) => {
      if (stream && stream.generation === state?.generation) return;
      stream?.request.destroy();
      if (state) openStream(state);
    });
  }, PUSH_WATCH_MS);
  watcher.unref();

  return () => {
    clearInterval(watcher);
    stream?.request.destroy();
  };
}
