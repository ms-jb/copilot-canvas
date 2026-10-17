import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createSessionsReader, type SessionsSource } from "../../src/host/sessions/reader.mts";
import { parseSessionMetadata } from "../../src/host/sessions/metadata.mts";
import { validateSessions, type SessionsInfo } from "../../src/shared/contract.mts";
import { deferred } from "./fixtures";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const current = id(1);
const time = "2026-10-17T20:00:00.000Z";
const timestamp = Date.parse(time);
const secret = "SECRET QUESTION TRANSCRIPT TOKEN";
const status = (sessions: unknown[]) => ({ summary: { total: sessions.length }, sessions });
const result = (value: unknown) => ({
  resultType: "success",
  textResultForLlm: JSON.stringify(value),
});

function source(execute = vi.fn(async (_request: unknown) => result(status([])))) {
  const listeners = new Set<Parameters<SessionsSource["on"]>[0]>();
  const session: SessionsSource = {
    rpc: { tools: { execute } },
    on: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return { session, execute, listeners };
}

const base = {
  sessionId: current,
  currentState: () => "idle" as const,
  readMetadata: async () => [],
  now: () => timestamp,
};
afterEach(() => vi.useRealTimers());

it("requests only native read-only status and returns sorted display fields, never payload content", async () => {
  const { session, execute } = source(
    vi.fn(async () =>
      result(
        status([
          {
            id: current,
            name: "Current",
            project_name: "test/repo",
            updated_at: time,
            activity: { status: "idle" },
          },
          {
            id: id(2),
            name: "Question",
            updated_at: "2026-10-17T20:01:00.000Z",
            awaiting_input: { question: secret, choices: [secret] },
            activity: { status: "blocked" },
            transcript: secret,
            token: secret,
            app_url: "https://evil.invalid/",
          },
          { id: id(3), name: "Closed", is_running: false, updated_at: time },
        ]),
      ),
    ),
  );
  const read = createSessionsReader({ ...base, session });
  const info = await read();
  expect(execute).toHaveBeenCalledWith({
    name: "get_sessions_status",
    arguments: {},
    toolCallId: expect.stringMatching(/^canvas-sessions-/),
  });
  expect(info.sessions.map((row) => [row.id, row.state, row.current])).toEqual([
    [id(2), "waiting", false],
    [current, "idle", true],
  ]);
  expect(info.sessions.every((row) => row.canOpen)).toBe(true);
  expect(JSON.stringify(info)).not.toContain(secret);
  expect(JSON.stringify(info)).not.toContain("evil");
  expect(validateSessions(info)).toBe(true);
});

it("limits to 30 newest rows and keeps the current session", async () => {
  const read = createSessionsReader({
    ...base,
    readMetadata: async () =>
      Array.from({ length: 50 }, (_, n) => ({
        id: id(n + 1),
        name: "x".repeat(300),
        project: "p".repeat(100),
        updatedAt: new Date(timestamp + n * 60_000).toISOString(),
      })),
  });
  const info = await read();
  expect(info.source).toBe("local");
  expect(info.sessions).toHaveLength(30);
  expect(info.sessions[0].id).toBe(id(50));
  expect(info.sessions.at(-1)?.id).toBe(current);
  expect(info.sessions[0]).toMatchObject({ state: "unknown", canOpen: false });
  expect(info.sessions.at(-1)).toMatchObject({ state: "idle", current: true });
  expect(validateSessions(info)).toBe(true);
});

it("shares concurrent reads and expires the metadata cache", async () => {
  let now = timestamp;
  const wait = deferred<never[]>();
  const readMetadata = vi.fn(() => wait.promise);
  const read = createSessionsReader({ ...base, readMetadata, now: () => now });
  const first = read();
  expect(read()).toBe(first);
  wait.resolve([]);
  await first;
  await read();
  expect(readMetadata).toHaveBeenCalledTimes(1);
  now += 25_000;
  await read();
  expect(readMetadata).toHaveBeenCalledTimes(2);
});

it.each([
  "Saved to: C:\\forbidden\\result.txt",
  "x".repeat(1024 * 1024 + 1),
  '{"summary":{"total":2},"sessions":[]}',
])("falls back without following an invalid or saved response", async (text) => {
  const { session } = source(
    vi.fn(async () => ({ resultType: "success", textResultForLlm: text })),
  );
  expect((await createSessionsReader({ ...base, session })()).source).toBe("local");
});

it("times out once without overlapping or retrying the native invocation", async () => {
  vi.useFakeTimers();
  const { session, execute } = source(vi.fn(() => new Promise<never>(() => {})));
  let now = timestamp;
  const read = createSessionsReader({ ...base, session, timeoutMs: 50, now: () => now });
  const pending = read();
  await vi.advanceTimersByTimeAsync(50);
  expect((await pending).source).toBe("local");
  now += 30_000;
  await read();
  expect(execute).toHaveBeenCalledTimes(1);
});

it("does not repeat app reads after a permission request and never answers it", async () => {
  const fake = source();
  fake.execute.mockImplementation(async () => {
    for (const listener of fake.listeners)
      listener({ type: "permission.requested", data: { secret } });
    return result(status([]));
  });
  let now = timestamp;
  const read = createSessionsReader({ ...base, session: fake.session, now: () => now });
  await read();
  now += 30_000;
  await read();
  expect(fake.execute).toHaveBeenCalledTimes(1);
  expect(fake.listeners.size).toBe(0);
});

it("distinguishes successful empty lists from unavailable sources", async () => {
  const { session } = source();
  expect((await createSessionsReader({ ...base, session })()).source).toBe("app");
  const info = await createSessionsReader({
    ...base,
    readMetadata: async () => {
      throw new Error(secret);
    },
  })();
  expect(info).toMatchObject({ source: "unavailable", sessions: [] });
  expect(JSON.stringify(info)).not.toContain(secret);
});

it("parses only selected single-line metadata and does not return cwd or other fields", () => {
  const parsed = parseSessionMetadata(
    `id: ${current}\nname: "A \\"quoted\\" name"\nsummary: safe\ncwd: C:\\Projects\\sample\nupdated_at: ${time}\ntoken: ${secret}\nmessages: ${secret}\nsummary_count: 7\n`,
    current,
  );
  expect(parsed).toEqual({
    id: current,
    name: 'A "quoted" name',
    summary: "safe",
    project: "sample",
    updatedAt: time,
  });
  expect(parseSessionMetadata(`id: ${id(2)}`, current)).toBeNull();
  expect(parseSessionMetadata(`id: ${current}\nname: ${"x".repeat(17000)}`, current)).toBeNull();
  expect(
    parseSessionMetadata(`id: ${current}\nname: |\n  ${secret}`, current)?.name,
  ).toBeUndefined();
  expect(JSON.stringify(parsed)).not.toContain(secret);
});

describe("session contract", () => {
  const info: SessionsInfo = {
    sessionId: current,
    source: "app",
    checkedAt: time,
    sessions: [
      {
        id: current,
        title: "Name",
        project: null,
        state: "idle",
        updatedAt: time,
        current: true,
        canOpen: true,
      },
    ],
  };
  it("accepts valid lists and rejects extras, unsafe links, invalid state/time and incorrect current flags", () => {
    expect(validateSessions(info)).toBe(true);
    for (const change of [
      { title: "" },
      { title: "x".repeat(161) },
      { project: "x".repeat(81) },
      { state: "finished" },
      { updatedAt: "yesterday" },
      { current: false },
      { id: "javascript:bad()" },
      { url: "https://evil.invalid" },
      { messages: secret },
    ])
      expect(validateSessions({ ...info, sessions: [{ ...info.sessions[0], ...change }] })).toBe(
        false,
      );
    expect(validateSessions({ ...info, source: "local" })).toBe(false);
    expect(validateSessions({ ...info, sessions: [info.sessions[0], info.sessions[0]] })).toBe(
      false,
    );
    expect(validateSessions({ ...info, sessions: Array(31).fill(info.sessions[0]) })).toBe(false);
    expect(validateSessions({ ...info, source: "unavailable", sessions: [] })).toBe(true);
  });
});
