import { expect, it, vi } from "vite-plus/test";
import {
  browserRecognizer,
  startRecognition,
  type Recognizer,
} from "../../ui/src/features/dictation/browserRecognition";
import { readResults, restartDelay, RESTART } from "../../ui/src/features/dictation/model";

class FakeRecognizer implements Recognizer {
  static last: FakeRecognizer;
  continuous = false;
  interimResults = false;
  lang = "";
  onaudiostart: Recognizer["onaudiostart"] = null;
  onresult: Recognizer["onresult"] = null;
  onerror: Recognizer["onerror"] = null;
  onend: Recognizer["onend"] = null;
  starts = 0;
  constructor() {
    FakeRecognizer.last = this;
  }
  start = () => void (this.starts += 1);
  stop = () => this.onend?.();
  abort = () => this.onend?.();
  say(...parts: [string, boolean][]) {
    this.onresult?.({
      resultIndex: 0,
      results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
    });
  }
}

function setup() {
  const timers: { callback: () => void; ms: number }[] = [];
  const events = {
    live: vi.fn(),
    interim: vi.fn(),
    committed: vi.fn(),
    ended: vi.fn(),
  };
  const session = startRecognition({
    Make: FakeRecognizer,
    language: "en-GB",
    events,
    schedule: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    unschedule: () => timers.pop(),
  });
  return { session, events, timers, recognizer: FakeRecognizer.last };
}

it("streams interim words and commits final ones, merged in order", () => {
  const { recognizer, events } = setup();
  expect(recognizer).toMatchObject({ continuous: true, interimResults: true, lang: "en-GB" });
  recognizer.say(["hello ", true], [" there", true], [" wor", false]);
  expect(events.committed).toHaveBeenCalledWith("hello there");
  expect(events.interim).toHaveBeenLastCalledWith("wor");
  expect(readResults([{ isFinal: false, 0: { transcript: " " } }], 0)).toEqual({
    final: "",
    interim: "",
  });
});

it("listens again after a pause with a backoff, and gives up at the cap", () => {
  const { recognizer, events, timers } = setup();
  for (let attempt = 0; attempt < RESTART.maxAttempts; attempt += 1) {
    recognizer.onerror?.({ error: "no-speech" });
    recognizer.onend?.();
    expect(timers.at(-1)?.ms).toBe(restartDelay(attempt));
    timers.at(-1)!.callback();
    expect(recognizer.starts).toBe(attempt + 2);
  }
  expect(events.ended).not.toHaveBeenCalled();
  recognizer.onend?.();
  expect(events.ended).toHaveBeenCalledWith(null);
});

it("counts the cap from the last words heard, and keeps unfinished words when it restarts", () => {
  const { recognizer, events, timers } = setup();
  recognizer.onend?.();
  timers.at(-1)!.callback();
  recognizer.say(["almost", false]);
  recognizer.onerror?.({ error: "aborted" });
  recognizer.onend?.();
  expect(events.committed).toHaveBeenCalledWith("almost");
  expect(timers.at(-1)?.ms).toBe(restartDelay(0));
});

it("stops for good on a tap, even between restarts", () => {
  const { session, recognizer, events, timers } = setup();
  recognizer.onend?.();
  session.stop();
  expect(events.ended).toHaveBeenCalledTimes(1);
  expect(events.ended).toHaveBeenCalledWith(null);
  expect(timers).toHaveLength(0);
});

it("take ends capture and hands back the words still interim", () => {
  const { session, recognizer, events } = setup();
  recognizer.say(["so far", false]);
  expect(session.take()).toBe("so far");
  expect(events.committed).not.toHaveBeenCalled();
  expect(events.ended).toHaveBeenCalledWith(null);
});

it("ends with a reason on a blocked microphone or unavailable browser speech service", () => {
  const blocked = setup();
  blocked.recognizer.onerror?.({ error: "not-allowed" });
  expect(blocked.events.ended).toHaveBeenCalledWith(expect.stringContaining("Microphone access"));

  const plain = setup();
  plain.recognizer.onerror?.({ error: "network" });
  expect(plain.events.ended.mock.calls[0]![0]).toContain("can't be reached");

  const offered = setup();
  offered.recognizer.onerror?.({ error: "service-not-allowed" });
  expect(offered.events.ended.mock.calls[0]![0]).toContain("can't be reached");
});

it("finds the recognizer under either name, or none", () => {
  expect(browserRecognizer({})).toBeUndefined();
  expect(browserRecognizer({ webkitSpeechRecognition: FakeRecognizer })).toBe(FakeRecognizer);
});
