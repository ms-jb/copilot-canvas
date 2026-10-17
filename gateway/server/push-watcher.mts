import http from "node:http";
import { API, LIMITS, SSE_EVENTS } from "../../extension-src/shared/contract.mts";
import type { ProviderState } from "../../extension-src/shared/runtime-state.mts";
import type { Notice } from "../push/notifications.mts";
import { parseSse } from "../streams/sse.mts";
import type { SelectProvider } from "./provider-discovery.mts";
import type { PushState } from "./push-state.mts";
import { LOOPBACK } from "./request-policy.mts";

// How often to check the live provider, and how long a silent stream may stay open.
const PUSH_WATCH_MS = 2000;
const PUSH_STREAM_IDLE_MS = 45_000;

export function watchPush(push: PushState, selectProvider: SelectProvider): () => void {
  let stream: { generation: string; request: http.ClientRequest } | null = null;

  function notify(notice: Notice | null) {
    if (!notice) return;
    push.latest = notice;
    void push.store.sendAll((endpoint) => push.presence.isFocused(endpoint));
  }

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
              const { snapshot } = value;
              notify(
                push.notifier.snapshot(value.generation, snapshot.status, snapshot.prompts ?? []),
              );
            } else if (event === SSE_EVENTS.status) notify(push.notifier.status(value.status));
            else if (event === SSE_EVENTS.prompts) notify(push.notifier.prompts(value.prompts));
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
