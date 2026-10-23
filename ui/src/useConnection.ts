import { useNetwork } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBootstrap, fetchIdentity, type SendContext } from "./api";
import { createStreamBatcher, flushesBufferedText } from "./connection/streamBatcher";
import { planResume, watchResume } from "./connection/resume";
import { recoverStalePage } from "./connection/staleReload";
import { isRemote } from "./remote";
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
  | "stale"
  /** The device itself has no network; overrides every other phase until it comes back. */
  | "offline";

export interface Connection {
  phase: ConnectionPhase;
  /** Null until the first bootstrap succeeds. */
  context: SendContext | null;
  config: PanelConfig | null;
  /** Live transcript, session status, native session controls and pending prompts. */
  view: ViewState;
  /** Call when the provider reports it restarted (for example a 409 stale_provider on send). */
  markStale: () => void;
}

const SSE_EVENT_NAMES = [
  "snapshot",
  "entry",
  "status",
  "controls",
  "prompts",
  "queue",
  "activity",
  "context",
  "append",
] as const;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
// EventSource retries on its own; after this long without a connection we call it "not connected".
const OFFLINE_AFTER_MS = 8000;
// `vp dev` only: `?state=offline` previews the offline state without turning the network off.
const PREVIEW_OFFLINE =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("state") === "offline";

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
    let stale = false;
    // A bootstrap in flight; resumes and retries never start a second one.
    let starting = false;
    const controller = new AbortController();
    // Events that arrive before the bootstrap names the generation.
    let early: ServerEvent[] = [];
    const batcher = createStreamBatcher({
      commit: (events) => {
        if (disposed || stale) return;
        setView((current) =>
          events.reduce((state, event) => applyServerEvent(state, event.name, event.data), current),
        );
      },
      scheduler: {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined),
      },
      frameFallbackMs: 50,
    });

    const closeSource = () => {
      batcher.flush();
      source?.close();
      source = null;
      clearTimeout(offlineTimer);
    };

    const markStale = () => {
      if (disposed || stale) return;
      stale = true;
      closeSource();
      clearTimeout(retryTimer);
      setPhase("stale");
      if (isRemote()) {
        recoverStalePage({
          storage: window.sessionStorage,
          now: Date.now,
          reload: () => window.location.reload(),
        });
      }
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
      // The stream opens with the bootstrap; until it knows the generation, events wait.
      if (!generation) early.push(event);
      else accept(event);
    };

    const accept = (event: ServerEvent) => {
      if (event.name === "snapshot" && event.data.generation !== generation) {
        markStale();
        return;
      }
      batcher.push(event);
      if (flushesBufferedText(event)) batcher.flush();
    };

    const recheckAfterClose = async () => {
      try {
        const identity = await fetchIdentity(controller.signal);
        if (disposed || stale) return;
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
      if (disposed || stale) return;
      closeSource();
      const next = new EventSource(`./${API.events}`);
      source = next;
      next.addEventListener("open", () => {
        retryDelay = RETRY_BASE_MS;
        clearTimeout(offlineTimer);
        setPhase((current) =>
          current === "stale" || current === "bootstrapping" ? current : "connected",
        );
      });
      for (const name of SSE_EVENT_NAMES) {
        next.addEventListener(name, (event) => {
          if (!disposed && !stale && source === next) handleEvent(name, event as MessageEvent);
        });
      }
      next.addEventListener("error", () => {
        if (disposed || source !== next) return;
        if (next.readyState === EventSource.CLOSED) {
          closeSource();
          // Before the bootstrap succeeded, its outcome decides what happens next.
          if (!generation) return;
          setPhase("disconnected");
          void recheckAfterClose();
          return;
        }
        setPhase((current) =>
          current === "connected" || current === "connecting" ? "reconnecting" : current,
        );
        clearTimeout(offlineTimer);
        offlineTimer = setTimeout(() => {
          // A timer that fires late on resume says nothing about the network; the resume reconnects.
          if (document.visibilityState === "hidden") return;
          setPhase((current) => (current === "reconnecting" ? "disconnected" : current));
        }, OFFLINE_AFTER_MS);
      });
    }

    // The bootstrap and the event stream start together; the stream's snapshot completes the
    // bootstrap's short transcript.
    async function start() {
      if (starting) return;
      starting = true;
      batcher.flush();
      generation = "";
      early = [];
      open();
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
          controls: bootstrap.controls,
          prompts: bootstrap.snapshot.prompts ?? [],
          ...(bootstrap.snapshot.queue ? { queue: bootstrap.snapshot.queue } : {}),
          ...(bootstrap.snapshot.context ? { context: bootstrap.snapshot.context } : {}),
        });
        const waiting = early;
        early = [];
        waiting.forEach(accept);
        if (stale) return;
        if (!source) open();
        setPhase(source?.readyState === EventSource.OPEN ? "connected" : "connecting");
      } catch {
        if (disposed) return;
        closeSource();
        setPhase("disconnected");
        scheduleRetry(() => void start());
      } finally {
        starting = false;
      }
    }

    void start();

    // Back from the background, a woken screen or the network returning: replace a stream the OS may
    // have killed instead of waiting for the browser's own retry. A resume never marks the page
    // stale on its own; only a changed generation in the fresh snapshot does (`accept`).
    const stopWatching = watchResume({
      doc: document,
      win: window,
      onResume: (resume) => {
        if (disposed) return;
        const plan = planResume(resume, {
          stale,
          hasGeneration: generation !== "",
          streamOpen: source?.readyState === EventSource.OPEN,
        });
        if (plan === "none") return;
        retryDelay = RETRY_BASE_MS;
        clearTimeout(retryTimer);
        if (plan === "bootstrap") return void start();
        setPhase((current) =>
          current === "reconnecting" || current === "disconnected" ? "connecting" : current,
        );
        open();
      },
    });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") batcher.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      stopWatching();
      document.removeEventListener("visibilitychange", onVisibility);
      controller.abort();
      clearTimeout(retryTimer);
      closeSource();
      batcher.dispose();
    };
  }, []);

  const { online } = useNetwork();
  const markStale = useCallback(() => staleRef.current(), []);
  return {
    phase: online && !PREVIEW_OFFLINE ? phase : "offline",
    context,
    config,
    view,
    markStale,
  };
}
