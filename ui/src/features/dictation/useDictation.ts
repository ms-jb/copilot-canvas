import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { browserRecognizer, startRecognition, type Recognition } from "./browserRecognition";
import { dictationReducer, IDLE_DICTATION, type DictationState } from "./model";
import { watchPageExit } from "./page-exit";

const MAX_DURATION_MS = 5 * 60_000;

export interface Dictation {
  state: DictationState;
  engine: "browser" | null;
  elapsedMs: number;
  toggle: () => void;
  dismiss: () => void;
  finishForSend: () => string;
  absorbInterim: () => void;
}

/** Browser-managed speech only: no recordings, host requests, keys or automatic sends. */
export function useDictation({
  onText,
  enabled,
}: {
  onText: (text: string) => void;
  enabled: boolean;
}): Dictation {
  const [state, dispatch] = useReducer(dictationReducer, IDLE_DICTATION);
  const [now, setNow] = useState(Date.now);
  const Make = useMemo(browserRecognizer, []);
  const capture = useRef<Recognition | null>(null);
  const skipSegment = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(onText);
  latest.current = onText;

  const finishForSend = useCallback(() => {
    const current = capture.current;
    capture.current = null;
    const words = current?.take() ?? "";
    dispatch({ type: "ended" });
    return skipSegment.current ? "" : words;
  }, []);
  const finish = useCallback(() => {
    const words = finishForSend();
    if (words) latest.current(words);
  }, [finishForSend]);

  const toggle = () => {
    if (capture.current) return finish();
    if (!enabled || !Make) return;
    skipSegment.current = false;
    dispatch({ type: "start", engine: "browser" });
    // startRecognition may fail synchronously, before it returns a handle.
    let ended = false;
    const opened = startRecognition({
      Make,
      language: navigator.language || "en-US",
      events: {
        live: () => {
          if (mounted.current) dispatch({ type: "live", at: Date.now() });
        },
        interim: (text) => {
          if (mounted.current && !skipSegment.current) dispatch({ type: "interim", text });
        },
        committed: (text) => {
          if (skipSegment.current) skipSegment.current = false;
          else if (mounted.current) latest.current(text);
        },
        ended: (problem) => {
          ended = true;
          capture.current = null;
          if (mounted.current) dispatch({ type: "failed", problem });
        },
      },
    });
    if (!ended) capture.current = opened;
  };

  const active = state.phase !== "idle";
  useEffect(() => {
    if (!enabled && capture.current) finish();
  }, [enabled, finish]);
  useEffect(() => {
    if (!active) return;
    const timeout = setTimeout(finish, MAX_DURATION_MS);
    const tick = setInterval(() => setNow(Date.now()), 500);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    const unwatch = watchPageExit({ document, window }, finish);
    return () => {
      clearTimeout(timeout);
      clearInterval(tick);
      window.removeEventListener("keydown", onKey, true);
      unwatch();
    };
  }, [active, finish]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      capture.current?.cancel();
      capture.current = null;
    };
  }, []);

  return {
    state,
    engine: Make ? "browser" : null,
    elapsedMs: state.startedAt === null ? 0 : Math.max(0, now - state.startedAt),
    toggle,
    dismiss: () => dispatch({ type: "dismiss" }),
    finishForSend,
    absorbInterim: () => {
      skipSegment.current = true;
      dispatch({ type: "interim", text: "" });
    },
  };
}
