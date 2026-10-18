import { expect, it } from "vite-plus/test";
import {
  validateQueuePayload,
  validateSendPayload,
  validateServerEvent,
} from "../src/shared/contract.mts";
import { applyServerEvent, createViewState, resolvePending } from "../src/shared/entries.mts";

const payload = { requestId: "request-1", sessionId: "session-1", text: "hello" };

it("defaults normal sends to immediate and accepts only the two explicit delivery modes", () => {
  expect(validateSendPayload(payload)).toMatchObject({ ok: true, value: { mode: "immediate" } });
  for (const mode of ["immediate", "enqueue"]) {
    expect(validateSendPayload({ ...payload, mode })).toMatchObject({ ok: true, value: { mode } });
  }
  for (const mode of [null, "", "queue", "steer", "immediate ".repeat(1000), 1, {}, ["enqueue"]]) {
    expect(validateSendPayload({ ...payload, mode }).ok).toBe(false);
  }
});

it("validates and applies queue removal events without deleting unrelated optimistic messages", () => {
  const queue = { removedRequestIds: ["request-1"] };
  expect(validateServerEvent("queue", { seq: 2, queue })).toBe(true);
  expect(validateServerEvent("queue", { seq: 2, queue: { removedRequestIds: [null] } })).toBe(
    false,
  );
  expect(
    validateServerEvent("queue", {
      seq: 2,
      queue: { removedRequestIds: Array(501).fill("request-1") },
    }),
  ).toBe(false);
  const next = applyServerEvent(createViewState(), "queue", { seq: 2, queue });
  expect(
    resolvePending(
      [{ requestId: "request-1" }, { requestId: "request-2" }],
      [],
      next.queue?.removedRequestIds,
    ),
  ).toEqual([{ requestId: "request-2" }]);
  expect(applyServerEvent(next, "queue", { seq: 1, queue: { removedRequestIds: [] } })).toBe(next);
});

it("validates queue items and change payloads", () => {
  const item = { id: "q1", requestId: "request-1", kind: "message", text: "hi" };
  expect(
    validateServerEvent("queue", { seq: 1, queue: { removedRequestIds: [], items: [item] } }),
  ).toBe(true);
  expect(
    validateServerEvent("queue", {
      seq: 1,
      queue: { removedRequestIds: [], items: [{ ...item, id: "" }] },
    }),
  ).toBe(false);
  const base = { sessionId: "session-1", id: "q1" };
  expect(validateQueuePayload({ ...base, action: "remove" })).toMatchObject({ ok: true });
  expect(validateQueuePayload({ ...base, action: "edit", text: "new" })).toMatchObject({
    ok: true,
  });
  expect(validateQueuePayload({ ...base, action: "move", toPosition: 2 })).toMatchObject({
    ok: true,
  });
  for (const bad of [
    { ...base, action: "edit", text: "  " },
    { ...base, action: "move", toPosition: -1 },
    { ...base, action: "remove", text: "x" },
    { ...base, action: "nuke" },
  ]) {
    expect(validateQueuePayload(bad).ok).toBe(false);
  }
});
