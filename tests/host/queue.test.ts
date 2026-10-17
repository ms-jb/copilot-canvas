import { expect, it, vi } from "vite-plus/test";
import { createQueueTracker } from "../../src/host/session/queue.mts";
import { createSessionBridge } from "../../src/host/session/bridge.mts";
import { createSendController } from "../../src/host/session/send-controller.mts";
import { deferred, fakeSession } from "./fixtures";

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
  expect(notify).toHaveBeenCalledWith({ removedRequestIds: ["request-1"] });
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
  await Promise.resolve();
  expect(bridge.getSnapshot().snapshot.queue?.removedRequestIds).toEqual(["request-1"]);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "queue",
      queue: { removedRequestIds: ["request-1"] },
    }),
  );
  bridge.dispose();
});
