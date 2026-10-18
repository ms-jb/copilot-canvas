import { expect, it } from "vite-plus/test";
import { ACTIVITY_LIMITS, validateServerEvent } from "../src/shared/contract.mts";
import type { ActivityItem, ToolItem, TranscriptEntry } from "../src/shared/contract.mts";
import { redactSecrets, summarizeArgs } from "../src/shared/activity.mts";
import { applyServerEvent, createViewState, NO_CONTROLS } from "../src/shared/entries.mts";
import { createTranscriptStore } from "../src/shared/transcript.mts";

let n = 0;
const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
function event(type: string, data: Record<string, unknown> = {}, second?: number) {
  n += 1;
  return { id: `evt-${n}`, type, timestamp: at(second ?? n), data };
}
const user = (messageId: string, second: number) =>
  event("user.message", { messageId, content: "hi" }, second);
const start = (toolCallId: string, toolName: string, args: unknown, second: number) =>
  event("tool.execution_start", { toolCallId, toolName, arguments: args }, second);
const complete = (toolCallId: string, second: number, data: Record<string, unknown> = {}) =>
  event("tool.execution_complete", { toolCallId, success: true, ...data }, second);
const activity = (store: ReturnType<typeof createTranscriptStore>) => store.snapshot().activity!;

it("pairs tool start and completion with duration, detail, args and result", () => {
  const store = createTranscriptStore();
  store.applyEvent(user("m1", 1));
  store.applyEvent(start("t1", "bash", { command: "ls -la\nwc -l", description: "List files" }, 2));
  expect(activity(store)).toEqual([
    {
      id: "tool:t1",
      kind: "tool",
      name: "bash",
      detail: "List files",
      state: "running",
      timestamp: at(2),
      args: "command: ls -la\nwc -l\ndescription: List files",
    },
  ]);
  store.applyEvent(event("tool.execution_progress", { toolCallId: "t1", progressMessage: "50%" }));
  expect(activity(store)[0]).toMatchObject({ progress: "50%" });
  store.applyEvent(complete("t1", 5, { result: { content: "3 files" } }));
  expect(activity(store)[0]).toMatchObject({
    state: "succeeded",
    durationMs: 3000,
    result: "3 files",
  });
  expect(activity(store)[0]).not.toHaveProperty("progress");

  store.applyEvent(start("t2", "view", { path: "/home/me/repos/app/src/index.ts" }, 6));
  store.applyEvent(
    complete("t2", 7, { success: false, error: { message: "No such file", code: "ENOENT" } }),
  );
  expect(activity(store)[1]).toMatchObject({
    state: "failed",
    detail: "…/app/src/index.ts",
    result: "No such file",
    durationMs: 1000,
  });
  // A completion without a start (or a repeat) changes nothing.
  expect(store.applyEvent(complete("unknown", 8))).toEqual([]);
});

it("shows intent in the status, hides report_intent and names sub-agents", () => {
  const store = createTranscriptStore();
  store.applyEvent(user("m1", 1));
  store.applyEvent(start("r1", "report_intent", { intent: "Exploring" }, 2));
  store.applyEvent(event("assistant.intent", { intent: "  Exploring\n the  codebase " }, 3));
  expect(store.snapshot().status).toEqual({
    phase: "working",
    activity: "thinking",
    intent: "Exploring the codebase",
  });
  store.applyEvent(start("t1", "task", { description: "Find the bug", prompt: "..." }, 4));
  store.applyEvent(event("subagent.started", { toolCallId: "t1", agentDisplayName: "Explore" }));
  expect(store.snapshot().status).toMatchObject({ activity: "tool", toolName: "task" });
  expect(store.snapshot().status.intent).toBe("Exploring the codebase");
  expect(activity(store)).toMatchObject([
    { id: "tool:t1", title: "Explore", detail: "Find the bug" },
  ]);
  store.applyEvent(event("assistant.idle", {}, 9));
  expect(store.snapshot().status).toEqual({ phase: "idle" });
});

it("streams thinking, interleaves it with tools and messages, and keeps it across turns", () => {
  const store = createTranscriptStore();
  store.applyEvent(user("m1", 1));
  const delta = (text: string, second: number) =>
    event("assistant.reasoning_delta", { reasoningId: "r1", deltaContent: text }, second);
  const changes = store.applyEvent(delta("Let me ", 2));
  expect(changes).toContainEqual({
    type: "activity",
    item: {
      id: "reasoning:r1",
      kind: "reasoning",
      text: "Let me ",
      timestamp: at(2),
      streaming: true,
    },
  });
  store.applyEvent(delta("check.", 3));
  store.applyEvent(start("t1", "grep", { pattern: "TODO" }, 4));
  store.applyEvent(event("assistant.message", { messageId: "a1", content: "Found it." }, 6));
  store.applyEvent(complete("t1", 5));
  expect(activity(store).map((item) => item.id)).toEqual(["reasoning:r1", "tool:t1"]);
  expect(activity(store)[0]).toMatchObject({ text: "Let me check.", streaming: true });

  // The turn ends: streaming thinking settles; the next user turn drops the old tool calls only.
  const ended = store.applyEvent(event("assistant.idle", {}, 7));
  expect(ended).toContainEqual({
    type: "activity",
    item: expect.objectContaining({ id: "reasoning:r1", streaming: false }),
  });
  store.applyEvent(user("m2", 8));
  expect(activity(store).map((item) => item.id)).toEqual(["reasoning:r1"]);
  expect(store.snapshot().entries.map((entry) => entry.id)).toEqual([
    "user:m1",
    "assistant:a1",
    "user:m2",
  ]);

  // The complete block replaces streamed text; encrypted (empty) thinking adds nothing.
  store.applyEvent(event("assistant.reasoning", { reasoningId: "r2", content: "Plan: A" }, 9));
  store.applyEvent(event("assistant.reasoning", { reasoningId: "r3", content: "" }, 10));
  expect(activity(store).map((item) => item.id)).toEqual(["reasoning:r1", "reasoning:r2"]);
});

it("keeps history replay idempotent and bounded", () => {
  const store = createTranscriptStore();
  const history = [user("m1", 1)];
  for (let index = 0; index < ACTIVITY_LIMITS.maxTools + 5; index += 1) {
    history.push(start(`t${index}`, "view", { path: `f${index}` }, 2 + index));
  }
  for (let index = 0; index < ACTIVITY_LIMITS.maxReasoning + 3; index += 1) {
    history.push(
      event("assistant.reasoning", { reasoningId: `r${index}`, content: "x" }, 100 + index),
    );
  }
  store.mergeHistory(history);
  store.mergeHistory(history);
  const items = activity(store);
  expect(items.filter((item) => item.kind === "tool")).toHaveLength(ACTIVITY_LIMITS.maxTools);
  expect(items.filter((item) => item.kind === "reasoning")).toHaveLength(
    ACTIVITY_LIMITS.maxReasoning,
  );
  expect(items.at(-1)!.id).toBe(`reasoning:r${ACTIVITY_LIMITS.maxReasoning + 2}`);
  expect(items[0]!.id).toBe("tool:t5");
});

it("redacts secrets and truncates arguments, results and thinking", () => {
  const args = summarizeArgs({
    command: "curl -H 'Authorization: Bearer abcdefghijklmnop' https://x.test",
    env: {
      HA_ACCESS_TOKEN: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
    },
    apiKey: "sk-live-1234567890abcdef",
    nested: { password: "hunter2", keep: "visible" },
    note: "export OPENROUTER_API_KEY=abc123 and ghp_abcdefghijklmnopqrstuvwxyz0123",
  })!;
  expect(args).not.toMatch(/abcdefghijklmnop'|eyJhbGci|sk-live|hunter2|abc123|ghp_/);
  expect(args).toContain("env: [redacted]");
  expect(args).toContain('"keep":"visible"');
  expect(redactSecrets("token: Zq8xK2mP9vL4nR7tY1wB5cD3fG6hJ0kA")).toBe("token: [redacted]");
  // Hashes and UUIDs stay readable.
  const sha = "248a2ef4c3b1d0e9f8a7b6c5d4e3f2a1b0c9d8e7";
  expect(redactSecrets(sha)).toBe(sha);
  expect(redactSecrets("key -> Zq8xK2mP9vL4nR7tY1wB5cD3fG6hJ0kAa9")).toBe("key -> [redacted]");

  const store = createTranscriptStore();
  store.applyEvent(user("m1", 1));
  store.applyEvent(start("t1", "create", { path: "a.txt", file_text: "x".repeat(50_000) }, 2));
  store.applyEvent(complete("t1", 3, { result: { content: "y".repeat(50_000) } }));
  store.applyEvent(
    event("assistant.reasoning", { reasoningId: "r1", content: "z".repeat(50_000) }, 4),
  );
  const [tool, thought] = activity(store) as [ToolItem, ActivityItem];
  expect(tool.args!.length).toBe(ACTIVITY_LIMITS.maxArgsChars);
  expect(tool.args!.endsWith("…")).toBe(true);
  expect(tool.result!.length).toBe(ACTIVITY_LIMITS.maxResultChars);
  expect(thought).toMatchObject({ truncated: true });
  expect(thought.kind === "reasoning" && thought.text.length).toBe(
    ACTIVITY_LIMITS.maxReasoningChars,
  );
  expect(
    validateServerEvent("snapshot", {
      seq: 1,
      generation: "g",
      snapshot: store.snapshot(),
      controls: NO_CONTROLS,
    }),
  ).toBe(true);
});

it("applies activity on the client: upserts, prunes on a new user turn, accepts old snapshots", () => {
  const entry = (id: string, timestamp: string): TranscriptEntry => ({
    id,
    kind: "user",
    text: id,
    timestamp,
  });
  const tool = (id: string, timestamp: string): ToolItem => ({
    id,
    kind: "tool",
    name: "bash",
    state: "running",
    timestamp,
  });
  // A snapshot from an older host has no activity at all.
  let state = applyServerEvent(createViewState(), "snapshot", {
    seq: 1,
    generation: "g",
    snapshot: { entries: [entry("user:m1", at(1))], status: { phase: "working" } },
    controls: NO_CONTROLS,
  });
  expect(state.activity).toEqual([]);
  state = applyServerEvent(state, "activity", { seq: 2, item: tool("tool:t1", at(3)) });
  state = applyServerEvent(state, "activity", {
    seq: 3,
    item: { id: "reasoning:r1", kind: "reasoning", text: "hm", timestamp: at(2) },
  });
  state = applyServerEvent(state, "activity", {
    seq: 4,
    item: { ...tool("tool:t1", at(3)), state: "succeeded" },
  });
  expect(state.activity.map((item) => item.id)).toEqual(["reasoning:r1", "tool:t1"]);
  state = applyServerEvent(state, "entry", { seq: 5, entry: entry("user:m2", at(4)) });
  expect(state.activity.map((item) => item.id)).toEqual(["reasoning:r1"]);

  expect(validateServerEvent("activity", { seq: 6, item: tool("tool:t2", at(5)) })).toBe(true);
  const huge = {
    ...tool("tool:t3", at(5)),
    result: "x".repeat(ACTIVITY_LIMITS.maxResultChars + 1),
  };
  expect(validateServerEvent("activity", { seq: 7, item: huge })).toBe(false);
  expect(validateServerEvent("activity", { seq: 8, item: { ...huge, kind: "shell" } })).toBe(false);

  // Streamed thinking grows by appends; a tool row or an unknown id is left alone.
  state = applyServerEvent(state, "append", {
    seq: 9,
    target: "activity",
    id: "reasoning:r1",
    text: "m, yes",
  });
  state = applyServerEvent(state, "append", {
    seq: 10,
    target: "activity",
    id: "tool:t1",
    text: "x",
  });
  state = applyServerEvent(state, "append", { seq: 11, target: "entry", id: "nope", text: "x" });
  expect(state.activity).toEqual([
    { id: "reasoning:r1", kind: "reasoning", text: "hmm, yes", timestamp: at(2) },
  ]);
  expect(state.seq).toBe(11);
  expect(validateServerEvent("append", { seq: 12, target: "entry", id: "a", text: "b" })).toBe(
    true,
  );
  expect(validateServerEvent("append", { seq: 12, target: "agent", id: "a", text: "b" })).toBe(
    false,
  );
});
