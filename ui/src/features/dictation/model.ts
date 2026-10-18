// Browser speech recognition only. Every exit returns the microphone to idle.
import { LIMITS } from "../../shared";

export type DictationEngine = "browser";
export type DictationPhase = "idle" | "starting" | "recording";

export interface DictationState {
  phase: DictationPhase;
  engine: DictationEngine | null;
  /** When capture actually began, for the elapsed timer. */
  startedAt: number | null;
  /** Why the last attempt failed; cleared by the next start or a dismiss. */
  problem: string | null;
  /** Words heard but not final yet, shown dimmed after the draft. */
  interim: string;
}

export type DictationEvent =
  | { type: "start"; engine: DictationEngine }
  | { type: "live"; at: number }
  | { type: "ended" }
  | { type: "interim"; text: string }
  | { type: "failed"; problem: string | null }
  | { type: "dismiss" };

export const IDLE_DICTATION: DictationState = {
  phase: "idle",
  engine: null,
  startedAt: null,
  problem: null,
  interim: "",
};

export function dictationReducer(state: DictationState, event: DictationEvent): DictationState {
  switch (event.type) {
    case "start":
      return state.phase === "idle"
        ? { ...IDLE_DICTATION, phase: "starting", engine: event.engine }
        : state;
    case "live":
      return state.phase === "starting"
        ? { ...state, phase: "recording", startedAt: event.at }
        : state;
    case "ended":
      return state.phase === "idle" ? state : { ...IDLE_DICTATION, problem: state.problem };
    case "interim":
      return state.phase === "idle" || state.interim === event.text
        ? state
        : { ...state, interim: event.text };
    case "failed":
      return { ...IDLE_DICTATION, problem: event.problem ?? state.problem };
    case "dismiss":
      return state.problem ? { ...state, problem: null } : state;
  }
}

export const isCapturing = (state: DictationState) =>
  state.phase === "starting" || state.phase === "recording";

/** Human-readable microphone errors. */
export function microphoneProblem(name: string | undefined): string {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked for this page. Allow it in the browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is in use by another app.";
    default:
      return "Couldn't start the microphone.";
  }
}

/** Web Speech API error codes. Null means end quietly (a pause, or a stop we asked for). */
export function recognizerProblem(code: string, requested: boolean): string | null {
  if (requested || code === "no-speech" || code === "aborted") return null;
  switch (code) {
    case "not-allowed":
      return microphoneProblem("NotAllowedError");
    case "audio-capture":
      return microphoneProblem("NotFoundError");
    case "service-not-allowed":
    case "network":
      return "This browser's speech service can't be reached from here.";
    default:
      return `This browser's dictation stopped (${code}).`;
  }
}

/** Recognizers end on their own after a pause (iOS Safari, Chrome): these errors mean "start again". */
export const isRestartableError = (code: string) => code === "no-speech" || code === "aborted";

export const RESTART = { maxAttempts: 4, baseMs: 300, maxMs: 3000 };

/** Wait before restart number `attempt` (from 0) with nothing heard in between; null past the cap. */
export function restartDelay(attempt: number): number | null {
  return attempt >= RESTART.maxAttempts
    ? null
    : Math.min(RESTART.baseMs * 2 ** attempt, RESTART.maxMs);
}

/** Final and interim words in the results an event reports, from `from` on. */
export function readResults(
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>,
  from: number,
): { final: string; interim: string } {
  const final: string[] = [];
  const interim: string[] = [];
  for (let index = from; index < results.length; index += 1) {
    const result = results[index];
    const text = result?.[0].transcript.trim();
    if (text) (result.isFinal ? final : interim).push(text);
  }
  return { final: final.join(" "), interim: interim.join(" ") };
}

/** Appends dictated text to the draft with one separating space, within the prompt limit. */
export function appendDictation(draft: string, text: string): string {
  const spoken = text.trim();
  if (!spoken) return draft;
  const joined = !draft || /\s$/.test(draft) ? draft + spoken : `${draft} ${spoken}`;
  return joined.slice(0, LIMITS.maxPromptChars);
}

/** The composer's text while dictating: the draft, then the interim words that are shown dimmed. */
export function withInterim(draft: string, interim: string): { shown: string; interim: string } {
  const shown = appendDictation(draft, interim);
  return { shown, interim: shown.slice(draft.length) };
}

/**
 * Maps an edit of the shown text back to the draft. An edit before the interim words keeps them
 * interim; one that touches them makes them typed text (`absorbed`), so dictation drops the rest
 * of that segment instead of adding it twice.
 */
export function editWithInterim(
  next: string,
  interim: string,
): { draft: string; absorbed: boolean } {
  if (!interim) return { draft: next, absorbed: false };
  if (next.endsWith(interim)) return { draft: next.slice(0, -interim.length), absorbed: false };
  return { draft: next, absorbed: true };
}

/** "0:07", "1:42". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
