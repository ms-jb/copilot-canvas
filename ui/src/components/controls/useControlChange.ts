import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "../../api";
import { API, ERROR_CODES, type ControlChange, type SessionControls } from "../../shared";
import type { Connection } from "../../useConnection";

interface ControlsResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  controls?: SessionControls;
}

const ERROR_TIMEOUT_MS = 8000;

/** True when the controls already reflect the requested change. */
export function reflects(controls: SessionControls, change: ControlChange): boolean {
  if ("mode" in change) return controls.mode === change.mode;
  if ("modelId" in change) return controls.modelId === change.modelId;
  if ("reasoningEffort" in change) return controls.reasoningEffort === change.reasoningEffort;
  return (controls.contextTier ?? "default") === change.contextTier;
}

export interface ControlChangeState {
  /** The change in flight, if any. Only one at a time. */
  pending: ControlChange | null;
  /** A change the session accepted but applies later (for example after the current turn). */
  deferred: ControlChange | null;
  error: string | null;
  apply: (change: ControlChange) => void;
}

/**
 * Posts one native setting change at a time. Live values always come from `connection.view.controls`
 * (the provider pushes a `controls` event); this hook only tracks the request itself.
 */
export function useControlChange(connection: Connection): ControlChangeState {
  const [pending, setPending] = useState<ControlChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<ControlChange | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const controls = connection.view.controls;
  const { context, markStale } = connection;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (deferred && reflects(controls, deferred)) setDeferred(null);
  }, [controls, deferred]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const apply = useCallback(
    (change: ControlChange) => {
      if (!context || busy.current) return;
      busy.current = true;
      setPending(change);
      setError(null);
      setDeferred(null);
      void (async () => {
        let failure: string | null = null;
        let later: ControlChange | null = null;
        try {
          const { status, body } = await postJson<ControlsResponse>(context, API.controls, {
            sessionId: context.sessionId,
            change,
          });
          if (status === 200 && body?.ok === true) {
            if (body.controls && !reflects(body.controls, change)) later = change;
          } else if (body?.code === ERROR_CODES.staleProvider) {
            markStale();
            failure = "The canvas restarted. Reload to continue.";
          } else {
            failure = body?.message ?? `The change was not applied (${status}).`;
          }
        } catch {
          failure = "Couldn't reach the session. Check the connection and try again.";
        }
        busy.current = false;
        if (!mounted.current) return;
        setPending(null);
        setError(failure);
        setDeferred(later);
      })();
    },
    [context, markStale],
  );

  return {
    pending,
    deferred,
    error,
    apply,
  };
}
