import { afterEach, expect, it, vi } from "vite-plus/test";
import { createSessionBridge } from "../../extension-src/lib/bridge.mts";
import { ERROR_CODES } from "../../extension-src/shared/contract.mts";
import { deferred, fakeSession } from "./fixtures";

afterEach(() => vi.useRealTimers());

it("accepts a send once and rejects its duplicate", async () => {
  const session = fakeSession();
  session.send = vi.fn(async () => "message-1");
  const bridge = createSessionBridge(session);
  await bridge.ready;
  const first = bridge.send("hello", "request-1");
  expect(await bridge.send("hello", "request-1")).toMatchObject({
    code: ERROR_CODES.duplicateRequest,
  });
  expect(await first).toEqual({
    ok: true,
    status: "accepted",
    requestId: "request-1",
    messageId: "message-1",
  });
  expect(session.send).toHaveBeenCalledTimes(1);
  bridge.dispose();
  expect(await bridge.send("hello", "request-2")).toMatchObject({ code: ERROR_CODES.sendFailed });
});

it("reports native send failure and permits an explicit retry", async () => {
  const session = fakeSession();
  session.send = vi
    .fn()
    .mockRejectedValueOnce(new Error("not accepted"))
    .mockResolvedValue("message-1");
  const bridge = createSessionBridge(session);
  expect(await bridge.send("hello", "request-1")).toMatchObject({
    status: "rejected",
    code: ERROR_CODES.sendFailed,
    message: "not accepted",
  });
  expect(await bridge.send("hello", "request-1")).toMatchObject({ status: "accepted" });
  bridge.dispose();
});

it("never resends an uncertain send and tags its late admission", async () => {
  vi.useFakeTimers();
  const pending = deferred<string>();
  const session = fakeSession();
  session.send = vi.fn(() => pending.promise);
  const bridge = createSessionBridge(session, { sendTimeoutMs: 20 });
  await bridge.ready;
  const first = bridge.send("hello", "request-1");
  await vi.advanceTimersByTimeAsync(21);
  expect(await first).toMatchObject({ status: "uncertain", code: ERROR_CODES.sendUncertain });
  expect(await bridge.send("hello", "request-1")).toMatchObject({
    code: ERROR_CODES.duplicateRequest,
  });
  pending.resolve("message-1");
  await vi.advanceTimersByTimeAsync(0);
  session.emit({
    id: "event-1",
    type: "user.message",
    timestamp: "2026-10-17T12:00:00Z",
    data: { messageId: "message-1", content: "hello" },
  });
  expect(bridge.getSnapshot().snapshot.entries[0]).toMatchObject({
    requestId: "request-1",
    text: "hello",
  });
  expect(session.send).toHaveBeenCalledTimes(1);
  bridge.dispose();
});
