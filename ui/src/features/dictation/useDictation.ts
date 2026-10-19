import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { browserRecognizer, startRecognition, type Recognition } from "./browserRecognition";
import { dictationReducer, IDLE_DICTATION, type DictationState } from "./model";
import { watchPageExit } from "./page-exit";

const MAX_DURATION_MS = 5 * 60_000;

export interface Dictation {
  state: DictationState;
  engine: "browser" | null;
  /** This browser has no speech recognition: the microphone is shown but cannot start. */
  unsupported: boolean;
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
  /** `sentenceBreak` is set from the second phrase of a recording on: it follows a full stop. */
  onText: (text: string, options?: { sentenceBreak?: boolean }) => void;
  enabled: boolean;
}): Dictation {
  const [state, dispatch] = useReducer(dictationReducer, IDLE_DICTATION);
  const [now, setNow] = useState(Date.now);
  const Make = useMemo(browserRecognizer, []);
  const capture = useRef<Recognition | null>(null);
  const skipSegment = useRef(false);
  const committed = useRef(0);
  const mounted = useRef(true);
  const latest = useRef(onText);
  latest.current = onText;

  const commit = useCallback((text: string) => {
    latest.current(text, { sentenceBreak: committed.current > 0 });
    committed.current += 1;
  }, []);
  const finishForSend = useCallback(() => {
    const current = capture.current;
    capture.current = null;
    const words = current?.take() ?? "";
    dispatch({ type: "ended" });
    return skipSegment.current ? "" : words;
  }, []);
  const finish = useCallback(() => {
    const words = finishForSend();
    if (words) commit(words);
  }, [finishForSend, commit]);

  const toggle = () => {
    if (capture.current) return finish();
    if (!enabled || !Make) return;
    skipSegment.current = false;
    committed.current = 0;
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
          if (skipSegment.current) {
            skipSegment.current = false;
            committed.current += 1;
          } else if (mounted.current) commit(text);
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
    unsupported: !Make,
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
