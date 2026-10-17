import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBootstrap, fetchIdentity, type SendContext } from "./api";
import {
  API,
  applyServerEvent,
  createViewState,
  validateServerEvent,
  type PanelConfig,
  type ServerEvent,
  type ViewState,
} from "./shared";

export type ConnectionPhase =
  | "bootstrapping"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "stale";

export interface Connection {
  phase: ConnectionPhase;
  /** Null until the first bootstrap succeeds. */
  context: SendContext | null;
  config: PanelConfig | null;
  view: ViewState;
  /** Call when the provider reports it restarted (for example a 409 stale_provider on send). */
  markStale: () => void;
}

const SSE_EVENT_NAMES = ["snapshot", "entry", "status"] as const;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
// EventSource retries on its own; after this long without a connection we call it "not connected".
const OFFLINE_AFTER_MS = 8000;

/**
 * Bootstraps the panel and keeps the transcript view state in sync over SSE.
 *
 * EventSource reconnects automatically and every (re)connection starts with a fresh `snapshot`, so
 * the reducer never has to patch gaps. If the browser gives up (non-SSE response), we probe the
 * identity endpoint ourselves and retry with backoff. A snapshot or identity from a different
 * provider generation means the extension restarted: the panel goes stale and asks for a reload.
 */
export function useConnection(): Connection {
  const [phase, setPhase] = useState<ConnectionPhase>("bootstrapping");
  const [context, setContext] = useState<SendContext | null>(null);
  const [config, setConfig] = useState<PanelConfig | null>(null);
  const [view, setView] = useState<ViewState>(createViewState);
  const staleRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let generation = "";
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RETRY_BASE_MS;
    const controller = new AbortController();

    const closeSource = () => {
      source?.close();
      source = null;
      clearTimeout(offlineTimer);
    };

    const markStale = () => {
      if (disposed) return;
      closeSource();
      clearTimeout(retryTimer);
      setPhase("stale");
    };
    staleRef.current = markStale;

    const scheduleRetry = (action: () => void) => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(action, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    const handleEvent = (name: (typeof SSE_EVENT_NAMES)[number], raw: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(String(raw.data));
      } catch {
        return;
      }
      if (!validateServerEvent(name, data)) return;
      // validateServerEvent has checked the payload shape for this event name.
      const event = { name, data } as ServerEvent;
      if (event.name === "snapshot" && event.data.generation !== generation) {
        markStale();
        return;
      }
      setView((current) => applyServerEvent(current, event.name, event.data));
    };

    const recheckAfterClose = async () => {
      try {
        const identity = await fetchIdentity(controller.signal);
        if (disposed) return;
        if (identity.generation !== generation) {
          markStale();
          return;
        }
      } catch {
        if (disposed) return;
      }
      scheduleRetry(open);
    };

    function open() {
      if (disposed) return;
      closeSource();
      const next = new EventSource(`./${API.events}`);
      source = next;
      next.addEventListener("open", () => {
        retryDelay = RETRY_BASE_MS;
        clearTimeout(offlineTimer);
        setPhase((current) => (current === "stale" ? current : "connected"));
      });
      for (const name of SSE_EVENT_NAMES) {
        next.addEventListener(name, (event) => handleEvent(name, event as MessageEvent));
      }
      next.addEventListener("error", () => {
        if (disposed || source !== next) return;
        if (next.readyState === EventSource.CLOSED) {
          closeSource();
          setPhase("disconnected");
          void recheckAfterClose();
          return;
        }
        setPhase((current) =>
          current === "connected" || current === "connecting" ? "reconnecting" : current,
        );
        clearTimeout(offlineTimer);
        offlineTimer = setTimeout(() => {
          setPhase((current) => (current === "reconnecting" ? "disconnected" : current));
        }, OFFLINE_AFTER_MS);
      });
    }

    async function start() {
      try {
        const bootstrap = await fetchBootstrap(controller.signal);
        if (disposed) return;
        generation = bootstrap.generation;
        setContext({
          sessionId: bootstrap.sessionId,
          csrfToken: bootstrap.csrfToken,
          generation,
        });
        setConfig(bootstrap.config);
        setView({
          ...createViewState(),
          generation,
          entries: bootstrap.snapshot.entries,
          status: bootstrap.snapshot.status,
        });
        setPhase("connecting");
        open();
      } catch {
        if (disposed) return;
        setPhase("disconnected");
        scheduleRetry(() => void start());
      }
    }

    void start();

    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(retryTimer);
      closeSource();
    };
  }, []);

  const markStale = useCallback(() => staleRef.current(), []);
  return { phase, context, config, view, markStale };
}
