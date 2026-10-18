import { expect, it } from "vite-plus/test";
import type { TranscriptEntry } from "../src/shared/contract.mts";
import { applyServerEvent, createViewState, NO_CONTROLS } from "../src/shared/entries.mts";
import { createTranscriptStore } from "../src/shared/transcript.mts";

let n = 0;
function event(
  type: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  n += 1;
  return {
    id: `evt-${n}`,
    type,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    data,
    ...extra,
  };
}
const user = (messageId: string, content: string, data: Record<string, unknown> = {}) =>
  event("user.message", { messageId, content, ...data });

it("merges history after a live subscription without duplicates", () => {
  const store = createTranscriptStore();
  const first = user("m1", "one");
  const live = user("m2", "two");
  store.applyEvent(live);
  store.mergeHistory([first, live]);
  expect(store.snapshot().entries.map((e) => e.id)).toEqual(["user:m1", "user:m2"]);
});

it("replaces streamed deltas with the final message", () => {
  const store = createTranscriptStore();
  store.applyEvent(event("assistant.message_delta", { messageId: "a1", deltaContent: "Hel" }));
  store.applyEvent(event("assistant.message_delta", { messageId: "a1", deltaContent: "lo" }));
  expect(store.snapshot().entries[0]).toMatchObject({ text: "Hello", streaming: true });
  store.applyEvent(event("assistant.message", { messageId: "a1", content: "Hello world" }));
  expect(store.snapshot().entries[0]).toMatchObject({ text: "Hello world", streaming: false });
});

it("hides system, plumbing and sub-agent events", () => {
  const store = createTranscriptStore();
  store.applyEvent(user("m1", "x", { source: "skill-foo" }));
  store.applyEvent(user("m2", "<system_notification>done</system_notification>"));
  store.applyEvent(event("user.message", { messageId: "m3", content: "x" }, { agentId: "sub" }));
  store.applyEvent(
    event("assistant.message", { messageId: "a1", content: "x" }, { agentId: "sub" }),
  );
  expect(store.snapshot().entries).toEqual([]);
});

it("shows a tool-request message that has text", () => {
  const store = createTranscriptStore();
  store.applyEvent(
    event("assistant.message", { messageId: "a1", content: "Looking.", toolRequests: [{}] }),
  );
  expect(store.snapshot().entries).toMatchObject([{ text: "Looking." }]);
});

it("tags a request before or after the user entry arrives", () => {
  const store = createTranscriptStore();
  store.applyEvent(user("m1", "hi"));
  store.tagRequest("m1", "req-1");
  store.tagRequest("m2", "req-2");
  store.applyEvent(user("m2", "again"));
  expect(store.snapshot().entries.map((e) => e.requestId)).toEqual(["req-1", "req-2"]);
});

it("derives activity and waiting status without answering", () => {
  const store = createTranscriptStore();
  store.applyEvent(event("tool.execution_start", { toolName: "read_file" }));
  expect(store.snapshot().status).toMatchObject({ activity: "tool", toolName: "read_file" });
  store.applyEvent(event("assistant.message_delta", { messageId: "a1", deltaContent: "x" }));
  expect(store.snapshot().status).toMatchObject({ phase: "working", activity: "responding" });
  store.applyEvent(event("permission.requested", { resolvedByHook: true }));
  expect(store.snapshot().status.phase).toBe("working");
  store.applyEvent(event("permission.requested"));
  expect(store.snapshot().status).toEqual({ phase: "waiting", waitingFor: "permission" });
  store.applyEvent(event("session.idle"));
  expect(store.snapshot().status).toEqual({ phase: "idle" });
});

it("settles a streaming assistant entry on idle, interruption and waiting", () => {
  const store = createTranscriptStore();
  store.applyEvent(event("assistant.message_delta", { messageId: "a1", deltaContent: "half" }));
  store.applyEvent(event("assistant.idle"));
  expect(store.snapshot().entries[0]).toMatchObject({ streaming: false });
  store.applyEvent(event("assistant.message_delta", { messageId: "a2", deltaContent: "half" }));
  store.applyEvent(event("abort"));
  expect(store.snapshot().entries.find((entry) => entry.id === "assistant:a2")).toMatchObject({
    streaming: false,
  });
  store.applyEvent(event("assistant.message_delta", { messageId: "a3", deltaContent: "half" }));
  store.applyEvent(event("permission.requested"));
  expect(store.snapshot().entries.find((entry) => entry.id === "assistant:a3")).toMatchObject({
    streaming: false,
  });
});

it("resyncs the client view from a snapshot and ignores stale events", () => {
  const entry = (id: string): TranscriptEntry => ({
    id,
    kind: "user",
    text: id,
    timestamp: "2026-01-01",
  });
  const snap = (seq: number, generation: string, ids: string[]) => ({
    seq,
    generation,
    snapshot: { entries: ids.map(entry), status: { phase: "idle" as const } },
    controls: NO_CONTROLS,
  });
  let state = applyServerEvent(createViewState(), "snapshot", snap(5, "g1", ["a"]));
  state = applyServerEvent(state, "entry", { seq: 6, entry: entry("b") });
  expect(applyServerEvent(state, "entry", { seq: 6, entry: entry("c") })).toBe(state);
  state = applyServerEvent(state, "snapshot", snap(0, "g2", ["z"]));
  expect(state).toMatchObject({ generation: "g2", seq: 0 });
  expect(state.entries.map((e) => e.id)).toEqual(["z"]);
});

it("removes stale streaming markers when a turn has already ended", () => {
  const state = applyServerEvent(createViewState(), "snapshot", {
    seq: 1,
    generation: "g",
    snapshot: {
      entries: [
        {
          id: "assistant:a1",
          kind: "assistant",
          text: "done",
          timestamp: "2026-01-01",
          streaming: true,
        },
      ],
      status: { phase: "idle" },
    },
    controls: NO_CONTROLS,
  });
  expect(state.entries[0]).toMatchObject({ streaming: false });
  const next = applyServerEvent(state, "status", { seq: 2, status: { phase: "waiting" } });
  expect(next.entries[0]).toMatchObject({ streaming: false });
});
