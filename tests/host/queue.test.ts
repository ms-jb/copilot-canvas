import { expect, it, vi } from "vite-plus/test";
import { createQueueTracker } from "../../src/host/session/queue.mts";
import { createSessionBridge } from "../../src/host/session/bridge.mts";
import { createSendController } from "../../src/host/session/send-controller.mts";
import { deferred, fakeSession } from "./fixtures";
import { QUEUE_LIMITS, validateQueueState } from "../../src/shared/contract.mts";

it("normal sends steer explicitly; only enqueue requests queue", async () => {
  const session = { send: vi.fn(async () => "message") };
  const controller = createSendController(session, {
    log: vi.fn(),
    admit: vi.fn(),
    sendTimeoutMs: 100,
  });
  await controller.send("now", "request-1");
  await controller.send("later", "request-2", [], "enqueue");
  expect(session.send.mock.calls).toEqual([
    [{ prompt: "now", mode: "immediate" }],
    [{ prompt: "later", mode: "enqueue" }],
  ]);
  controller.dispose();
});

it("removes only admitted queue entries absent from a valid native snapshot", async () => {
  const result = { items: [{ kind: "message", messageId: "message-1" }], steeringMessages: [] };
  const rpc = { pendingItems: vi.fn(async (): Promise<unknown> => result) };
  const notify = vi.fn();
  const queue = createQueueTracker(rpc, notify);
  queue.admitted("message-1", "request-1");
  await queue.refresh();
  expect(queue.snapshot().removedRequestIds).toEqual([]);
  result.items = [];
  await queue.refresh();
  expect(queue.snapshot().removedRequestIds).toEqual(["request-1"]);
  expect(notify).toHaveBeenCalledWith({ removedRequestIds: ["request-1"], items: [] });
  queue.dispose();
});

it("keeps the turn being started and confirmed messages, even when absent from pending items", async () => {
  const rpc = {
    pendingItems: vi.fn(async () => ({
      items: [],
      steeringMessages: [],
      withdrawableTurnMessageId: "starting",
    })),
  };
  const queue = createQueueTracker(rpc, vi.fn());
  queue.confirmed("seen");
  queue.admitted("seen", "request-1");
  queue.admitted("starting", "request-2");
  await queue.refresh();
  expect(queue.snapshot().removedRequestIds).toEqual([]);
  queue.dispose();
});

it("does not treat failed, malformed or unavailable reads as an empty queue", async () => {
  for (const value of [
    null,
    {},
    { items: [] },
    { items: [{}], steeringMessages: [] },
    { items: [], steeringMessages: false },
  ]) {
    const queue = createQueueTracker({ pendingItems: async () => value }, vi.fn());
    queue.admitted("message-1", "request-1");
    await queue.refresh();
    expect(queue.snapshot().removedRequestIds).toEqual([]);
    queue.dispose();
  }
  const queue = createQueueTracker(
    {
      pendingItems: async () => {
        throw new Error("offline");
      },
    },
    vi.fn(),
  );
  queue.admitted("message-1", "request-1");
  await queue.refresh();
  expect(queue.snapshot().removedRequestIds).toEqual([]);
  queue.dispose();
});

it("ignores sends and confirmations newer than an in-flight queue read", async () => {
  const read = deferred<unknown>();
  const rpc = {
    pendingItems: vi
      .fn()
      .mockImplementationOnce(() => read.promise)
      .mockResolvedValue({ items: [{ kind: "message", messageId: "new" }], steeringMessages: [] }),
  };
  const queue = createQueueTracker(rpc, vi.fn());
  queue.admitted("old", "request-1");
  queue.admitted("new", "request-2");
  queue.confirmed("old");
  read.resolve({ items: [], steeringMessages: [] });
  await read.promise;
  await queue.refresh();
  expect(queue.snapshot().removedRequestIds).toEqual([]);
  queue.dispose();
});

it("reconciles after Stop/abort and emits queue removals to connected and reconnecting pages", async () => {
  let items = [{ kind: "message", messageId: "message-1" }];
  const session = fakeSession({
    queue: { pendingItems: async () => ({ items, steeringMessages: [] }) },
    abort: async () => {
      items = [];
      return { success: true };
    },
  });
  const bridge = createSessionBridge(session);
  const events: unknown[] = [];
  bridge.subscribe((event) => events.push(event));
  await bridge.ready;
  await bridge.send("later", "request-1", [], "enqueue");
  expect(bridge.getSnapshot().snapshot.queue?.removedRequestIds).toEqual([]);
  expect(await bridge.stop()).toBe("stopped");
  await vi.waitFor(() =>
    expect(bridge.getSnapshot().snapshot.queue?.removedRequestIds).toEqual(["request-1"]),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "queue",
      queue: { removedRequestIds: ["request-1"], items: [] },
    }),
  );
  bridge.dispose();
});

function fakeNativeQueue(texts: string[]) {
  let rows = texts.map((text, index) => ({
    id: `q${index + 1}`,
    messageId: `m${index + 1}`,
    kind: "message",
    displayText: text,
  }));
  const rpc = {
    pendingItems: vi.fn(async () => ({
      items: rows.map((row) => ({ ...row })),
      steeringMessages: [],
    })),
    removeAt: vi.fn(async ({ id }: { id: string }) => {
      const before = rows.length;
      rows = rows.filter((row) => row.id !== id);
      return { removed: rows.length < before };
    }),
    moveItem: vi.fn(async ({ id, toPosition }: { id: string; toPosition: number }) => {
      const row = rows.find((candidate) => candidate.id === id)!;
      rows = rows.filter((candidate) => candidate !== row);
      rows.splice(toPosition, 0, row);
      return { changed: true };
    }),
    updateText: vi.fn(async ({ id, prompt }: { id: string; prompt: string }) => {
      rows = rows.map((row) => (row.id === id ? { ...row, displayText: prompt } : row));
      return { updated: true };
    }),
    deliverNext: () => rows.shift(),
  };
  return rpc;
}

it("lists the native queue in order, so a reloaded page or a second client sees the same list", async () => {
  const rpc = fakeNativeQueue(["first", "second"]);
  const session = fakeSession({ queue: rpc });
  const bridge = createSessionBridge(session);
  await bridge.ready;
  const texts = () => bridge.getSnapshot().snapshot.queue?.items?.map((item) => item.text);
  // Queued before this bridge existed (an extension reload): still listed on the first snapshot.
  expect(texts()).toEqual(["first", "second"]);
  await bridge.send("third", "request-0003", [], "enqueue");
  rpc.deliverNext();
  session.emit({ type: "pending_messages.modified", timestamp: "2026-10-18T12:00:00Z", data: {} });
  await vi.waitFor(() => expect(texts()).toEqual(["second"]));
  bridge.dispose();
});

it("attaches the composer request id to the queue item it created", async () => {
  const rpc = fakeNativeQueue(["later"]);
  const bridge = createSessionBridge({ ...fakeSession({ queue: rpc }), send: async () => "m1" });
  await bridge.ready;
  await bridge.send("later", "request-0001", [], "enqueue");
  await vi.waitFor(() =>
    expect(bridge.getSnapshot().snapshot.queue?.items).toEqual([
      { id: "q1", requestId: "request-0001", kind: "message", text: "later" },
    ]),
  );
  bridge.dispose();
});

it("sends a queued message now through the session, then drops it from the queue", async () => {
  const rpc = fakeNativeQueue(["wait", "later"]);
  const send = vi.fn(async (_options: { prompt: string; mode?: string }) => "m9");
  const bridge = createSessionBridge({ ...fakeSession({ queue: rpc }), send });
  await bridge.ready;
  expect(
    await bridge.changeQueue({ action: "send_now", id: "q1", requestId: "request-0009" }),
  ).toBe("done");
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: "wait", mode: "immediate" }));
  expect(bridge.getSnapshot().snapshot.queue?.items?.map((item) => item.text)).toEqual(["later"]);
  bridge.dispose();
});

it("edits, reorders and removes queued messages; a missing item is reported gone", async () => {
  const rpc = fakeNativeQueue(["a", "b", "c"]);
  const notify = vi.fn();
  const queue = createQueueTracker(rpc, notify);
  await queue.refresh();
  const texts = () => queue.snapshot().items?.map((item) => item.text);
  expect(await queue.change({ action: "edit", id: "q1", text: "a2" })).toBe("done");
  expect(rpc.updateText).toHaveBeenCalledWith({ id: "q1", prompt: "a2" });
  expect(await queue.change({ action: "move", id: "q3", toPosition: 0 })).toBe("done");
  expect(texts()).toEqual(["c", "a2", "b"]);
  expect(await queue.change({ action: "remove", id: "q2" })).toBe("done");
  expect(texts()).toEqual(["c", "a2"]);
  expect(await queue.change({ action: "remove", id: "q2" })).toBe("gone");
  expect(rpc.removeAt).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalled();
  queue.dispose();
});

it("serializes changes from two clients so a repeated remove acts once", async () => {
  const rpc = fakeNativeQueue(["a", "b"]);
  const queue = createQueueTracker(rpc, vi.fn());
  await queue.refresh();
  const outcomes = await Promise.all([
    queue.change({ action: "remove", id: "q1" }),
    queue.change({ action: "remove", id: "q1" }),
  ]);
  expect(outcomes.sort()).toEqual(["done", "gone"]);
  expect(rpc.removeAt).toHaveBeenCalledTimes(1);
  queue.dispose();
});

it("sends one queued item now once, even when two clients click it together", async () => {
  const rpc = fakeNativeQueue(["wait", "later"]);
  const sendImmediate = vi.fn(async () => true);
  const queue = createQueueTracker(rpc, vi.fn(), { sendImmediate });
  await queue.refresh();
  const outcomes = await Promise.all([
    queue.change({ action: "send_now", id: "q1", requestId: "request-101" }),
    queue.change({ action: "send_now", id: "q1", requestId: "request-102" }),
  ]);
  expect(outcomes.sort()).toEqual(["done", "gone"]);
  expect(sendImmediate).toHaveBeenCalledOnce();
  expect(sendImmediate).toHaveBeenCalledWith("wait", "request-101");
  expect(queue.snapshot().items?.map((item) => item.id)).toEqual(["q2"]);
  queue.dispose();
});

it("replays a send-now request id without sending again", async () => {
  const rpc = fakeNativeQueue(["wait"]);
  const sendImmediate = vi.fn(async () => true);
  const queue = createQueueTracker(rpc, vi.fn(), { sendImmediate });
  await queue.refresh();
  const change = { action: "send_now", id: "q1", requestId: "request-555" } as const;
  expect(await queue.change(change)).toBe("done");
  expect(await queue.change(change)).toBe("done");
  expect(sendImmediate).toHaveBeenCalledOnce();
  expect(rpc.removeAt).toHaveBeenCalledOnce();
  queue.dispose();
});

it("keeps an item queued when send-now cannot deliver it, and never sends a clipped one", async () => {
  const rpc = fakeNativeQueue(["wait", "x".repeat(QUEUE_LIMITS.maxTextChars + 1)]);
  const sendImmediate = vi.fn(async () => false);
  const queue = createQueueTracker(rpc, vi.fn(), { sendImmediate });
  await queue.refresh();
  expect(await queue.change({ action: "send_now", id: "q1", requestId: "request-700" })).toBe(
    "failed",
  );
  expect(await queue.change({ action: "send_now", id: "q2", requestId: "request-701" })).toBe(
    "unavailable",
  );
  expect(sendImmediate).toHaveBeenCalledOnce();
  expect(rpc.removeAt).not.toHaveBeenCalled();
  expect(queue.snapshot().items?.map((item) => item.id)).toEqual(["q1", "q2"]);
  queue.dispose();
});

it("reports unavailable when this Copilot has no queue editing", async () => {
  const queue = createQueueTracker(
    { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
    vi.fn(),
  );
  expect(await queue.change({ action: "remove", id: "q1" })).toBe("unavailable");
  queue.dispose();
});

it("does not mutate against a failed or timed-out refresh", async () => {
  for (const fail of [async () => ({}), () => new Promise<unknown>(() => {})]) {
    const rpc = fakeNativeQueue(["a"]);
    const queue = createQueueTracker(rpc, vi.fn(), { timeoutMs: 5 });
    await queue.refresh();
    rpc.pendingItems.mockImplementationOnce(fail as typeof rpc.pendingItems);
    expect(await queue.change({ action: "remove", id: "q1" })).toBe("failed");
    expect(rpc.removeAt).not.toHaveBeenCalled();
    queue.dispose();
  }
});

it("bounds native queue display and refuses editing clipped text", async () => {
  const rpc = fakeNativeQueue([
    "x".repeat(QUEUE_LIMITS.maxTextChars + 1),
    ...Array.from({ length: 205 }, () => "short"),
  ]);
  const queue = createQueueTracker(rpc, vi.fn());
  await queue.refresh();
  expect(validateQueueState(queue.snapshot())).toBe(true);
  expect(queue.snapshot().items).toHaveLength(QUEUE_LIMITS.maxItems);
  expect(queue.snapshot().items?.[0]?.truncated).toBe(true);
  expect(await queue.change({ action: "edit", id: "q1", text: "clipped replacement" })).toBe(
    "unavailable",
  );
  expect(rpc.updateText).not.toHaveBeenCalled();
  queue.dispose();
});

it("sending the same request twice from two clients reaches the session once", async () => {
  const session = { send: vi.fn(async () => "m1") };
  const controller = createSendController(session, {
    log: vi.fn(),
    admit: vi.fn(),
    sendTimeoutMs: 100,
  });
  const [first, second] = await Promise.all([
    controller.send("later", "request-0001", [], "enqueue"),
    controller.send("later", "request-0001", [], "enqueue"),
  ]);
  expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  expect(session.send).toHaveBeenCalledTimes(1);
  controller.dispose();
});
