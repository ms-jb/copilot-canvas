import { expect, it } from "vite-plus/test";
import type { ServerEvent } from "../../ui/src/shared";
import { createViewState, applyServerEvent, type ViewState } from "../../src/shared/entries.mts";
import { createStreamBatcher, flushesBufferedText } from "../../ui/src/connection/streamBatcher";

const append = (seq: number, id: string, text: string): ServerEvent => ({
  name: "append",
  data: { seq, target: "entry", id, text },
});

function scheduler() {
  let next = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  return {
    hooks: {
      requestFrame(callback: () => void) {
        const id = next++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame(handle: number) {
        frames.delete(handle);
      },
      setTimer(callback: () => void) {
        const id = next++;
        timers.set(id, callback);
        return id;
      },
      clearTimer(handle: unknown) {
        if (handle !== undefined) timers.delete(Number(handle));
      },
    },
    frameCount: () => frames.size,
    timerCount: () => timers.size,
    runFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
    runTimer() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}

it("does not move interleaved targets ahead of their global sequence", () => {
  const commits: ServerEvent[][] = [];
  const fake = scheduler();
  const batcher = createStreamBatcher({
    frameFallbackMs: 100,
    scheduler: fake.hooks,
    commit: (events) => commits.push(events),
  });

  batcher.push(append(1, "a", "he"));
  batcher.push(append(2, "b", "x"));
  batcher.push(append(3, "a", "llo"));
  fake.runFrame();

  expect(commits).toEqual([[append(1, "a", "he"), append(2, "b", "x"), append(3, "a", "llo")]]);
  const initial: ViewState = {
    ...createViewState(),
    entries: ["a", "b"].map((id) => ({
      id,
      kind: "assistant" as const,
      text: "",
      timestamp: "2026-10-18T12:00:00Z",
    })),
  };
  const result = commits
    .flat()
    .reduce((state, event) => applyServerEvent(state, event.name, event.data), initial);
  expect(result.entries.map((entry) => entry.text)).toEqual(["hello", "x"]);
});

it("commits at most once per frame", () => {
  const commits: ServerEvent[][] = [];
  const fake = scheduler();
  const batcher = createStreamBatcher({
    frameFallbackMs: 100,
    scheduler: fake.hooks,
    commit: (events) => commits.push(events),
  });
  batcher.push(append(1, "a", "a"));
  batcher.push(append(2, "a", "b"));
  batcher.push(append(3, "a", "c"));

  expect(fake.frameCount()).toBe(1);
  fake.runFrame();
  expect(commits).toHaveLength(1);
  expect(commits[0]).toEqual([append(3, "a", "abc")]);
});

it("falls back to timer flush when no animation frame runs", () => {
  const commits: ServerEvent[][] = [];
  const fake = scheduler();
  const batcher = createStreamBatcher({
    frameFallbackMs: 100,
    scheduler: fake.hooks,
    commit: (events) => commits.push(events),
  });
  batcher.push(append(1, "a", "hey"));
  expect(fake.timerCount()).toBe(1);
  fake.runTimer();
  expect(commits).toEqual([[append(1, "a", "hey")]]);
});

it("flushes before turn-end events and preserves final text over random chunking", () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    let state = seed;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const source = Array.from({ length: 200 }, () =>
      String.fromCharCode(97 + Math.floor(rand() * 26)),
    ).join("");
    const chunks: string[] = [];
    for (let index = 0; index < source.length;) {
      const size = 1 + Math.floor(rand() * 8);
      chunks.push(source.slice(index, index + size));
      index += size;
    }

    const fake = scheduler();
    const committed: ServerEvent[] = [];
    const batcher = createStreamBatcher({
      frameFallbackMs: 100,
      scheduler: fake.hooks,
      commit: (events) => committed.push(...events),
    });
    const expected: ServerEvent[] = [];
    let seq = 1;
    expected.push({
      name: "entry",
      data: {
        seq,
        entry: {
          id: "assistant:a1",
          kind: "assistant",
          text: "",
          timestamp: "2026-01-01T00:00:00.000Z",
          streaming: true,
        },
      },
    });
    batcher.push(expected[0]!);
    fake.runFrame();
    for (const chunk of chunks) {
      seq += 1;
      const event = append(seq, "assistant:a1", chunk);
      expected.push(event);
      batcher.push(event);
      if (rand() > 0.5) fake.runFrame();
    }
    seq += 1;
    const done: ServerEvent = {
      name: "status",
      data: { seq, status: { phase: "idle" } },
    };
    expected.push(done);
    if (flushesBufferedText(done)) batcher.flush();
    batcher.push(done);
    fake.runFrame();

    const apply = (events: ServerEvent[]) =>
      events.reduce(
        (view, event) => applyServerEvent(view, event.name, event.data),
        createViewState(),
      );
    const expectedText = apply(expected).entries.find((entry) => entry.id === "assistant:a1")?.text;
    const actualText = apply(committed).entries.find((entry) => entry.id === "assistant:a1")?.text;
    expect(actualText).toBe(expectedText);
  }
});

it("flags end and error events as flush boundaries", () => {
  expect(
    flushesBufferedText({
      name: "status",
      data: { seq: 1, status: { phase: "working", activity: "thinking" } },
    }),
  ).toBe(false);
  expect(
    flushesBufferedText({
      name: "status",
      data: { seq: 2, status: { phase: "idle" } },
    }),
  ).toBe(true);
  expect(
    flushesBufferedText({
      name: "entry",
      data: {
        seq: 3,
        entry: {
          id: "assistant:e1",
          kind: "error",
          text: "boom",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  ).toBe(true);
});
