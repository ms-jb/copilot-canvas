// The browser's own recognizer (SpeechRecognition / webkitSpeechRecognition), free of any account.
// Browsers end a session on their own after a pause (iOS Safari and Chrome both do), so while the
// microphone is on it listens again, with a backoff and a cap so silence can't loop forever.
import { isRestartableError, readResults, recognizerProblem, restartDelay } from "./model";

// The slice of the Web Speech API used here; not every DOM lib declares it.
export interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onaudiostart: (() => void) | null;
  onresult: ((event: RecognizerResults) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognizerResults {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
export type RecognizerClass = new () => Recognizer;

export function browserRecognizer(scope: object = window): RecognizerClass | undefined {
  const { SpeechRecognition, webkitSpeechRecognition } = scope as {
    SpeechRecognition?: RecognizerClass;
    webkitSpeechRecognition?: RecognizerClass;
  };
  return SpeechRecognition ?? webkitSpeechRecognition;
}

export interface RecognitionEvents {
  /** The microphone is open (fires again after each restart). */
  live: () => void;
  interim: (text: string) => void;
  committed: (text: string) => void;
  /** Capture is over; a problem is set when it ended badly rather than by a stop or silence. */
  ended: (problem: string | null) => void;
}

export interface Recognition {
  /** Ends capture and keeps what was heard. */
  stop(): void;
  /** Ends capture and discards what is still interim. */
  cancel(): void;
  /** Ends capture now and returns the words still interim. */
  take(): string;
}

export function startRecognition({
  Make,
  language,
  events,
  schedule = setTimeout,
  unschedule = clearTimeout,
}: {
  Make: RecognizerClass;
  language: string;
  events: RecognitionEvents;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): Recognition {
  const COULD_NOT_START = "This browser's dictation couldn't start.";
  let requested = false;
  let ended = false;
  let interim = "";
  // Restarts since the recognizer last heard something.
  let restarts = 0;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let recognizer: Recognizer;

  const finish = (problem: string | null) => {
    if (ended) return;
    ended = true;
    if (restart !== undefined) unschedule(restart);
    events.ended(problem);
  };
  const begin = () => {
    try {
      recognizer.start();
    } catch {
      finish(COULD_NOT_START);
    }
  };
  const self: Recognition = {
    stop() {
      requested = true;
      try {
        recognizer.stop();
      } catch {
        finish(null);
      }
      // Between restarts nothing is listening, so no end event will come.
      if (restart !== undefined) finish(null);
    },
    cancel() {
      requested = true;
      interim = "";
      try {
        recognizer.abort();
      } catch {
        // Already ended.
      }
      finish(null);
    },
    take() {
      const heard = interim;
      self.cancel();
      return heard;
    },
  };

  try {
    recognizer = new Make();
  } catch {
    finish(COULD_NOT_START);
    return self;
  }
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = language;
  recognizer.onaudiostart = () => {
    if (!ended) events.live();
  };
  recognizer.onresult = (event) => {
    if (ended) return;
    restarts = 0;
    const heard = readResults(event.results, event.resultIndex);
    if (heard.final) events.committed(heard.final);
    interim = heard.interim;
    events.interim(interim);
  };
  recognizer.onerror = (event) => {
    // A pause or an abort the browser chose: onend follows and decides whether to listen again.
    if (!requested && isRestartableError(event.error)) return;
    const problem = recognizerProblem(event.error, requested);
    finish(problem);
  };
  recognizer.onend = () => {
    if (ended) return;
    // Words the browser never finalized (iOS Safari) are kept rather than dropped.
    if (interim) {
      events.committed(interim);
      interim = "";
      events.interim("");
    }
    const delay = requested ? null : restartDelay(restarts);
    if (delay === null) return finish(null);
    restarts += 1;
    restart = schedule(() => {
      restart = undefined;
      if (!ended) begin();
    }, delay);
  };
  begin();
  return self;
}
