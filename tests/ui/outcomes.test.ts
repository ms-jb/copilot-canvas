import { expect, it } from "vite-plus/test";
import { respondOutcome } from "../../ui/src/connection/prompt-actions";
import { sendOutcome } from "../../ui/src/connection/session-actions";
import { ERROR_CODES } from "../../ui/src/shared";

it("accepts only successful HTTP responses with an explicit accepted status", () => {
  expect(sendOutcome(202, { status: "accepted", messageId: "message-1" })).toEqual({
    kind: "accepted",
    messageId: "message-1",
  });
  expect(respondOutcome(200, { status: "accepted" })).toEqual({ kind: "accepted" });
  for (const body of [null, {}, { status: 1 }, { status: "unknown" }]) {
    expect(sendOutcome(200, body).kind).toBe("uncertain");
    expect(respondOutcome(200, body).kind).toBe("rejected");
  }
  expect(sendOutcome(500, { status: "accepted" }).kind).toBe("uncertain");
  expect(respondOutcome(500, { status: "accepted" }).kind).toBe("uncertain");
});

it("takes stale-provider identity failures before any successful status", () => {
  const body = { code: ERROR_CODES.staleProvider, status: "accepted" };
  expect(sendOutcome(200, body).kind).toBe("stale");
  expect(respondOutcome(200, body).kind).toBe("stale");
});

it("keeps duplicate sends uncertain but rejects concurrent prompt answers", () => {
  const body = { code: ERROR_CODES.duplicateRequest };
  expect(sendOutcome(409, body).kind).toBe("uncertain");
  expect(respondOutcome(409, body)).toEqual({
    kind: "rejected",
    message: "This request is already being answered.",
  });
  expect(respondOutcome(409, { code: ERROR_CODES.promptResolved })).toEqual({ kind: "resolved" });
});

it("does not treat unreadable server failures as proof that an answer was rejected", () => {
  for (const body of [null, undefined, "broken", { code: 42 }]) {
    expect(sendOutcome(503, body).kind).toBe("uncertain");
    expect(respondOutcome(503, body).kind).toBe("uncertain");
  }
  expect(
    respondOutcome(504, { code: ERROR_CODES.respondUncertain, message: "Check first" }),
  ).toEqual({
    kind: "uncertain",
    message: "Check first",
  });
  expect(sendOutcome(409, { status: "uncertain" }).kind).toBe("uncertain");
  expect(respondOutcome(409, { code: ERROR_CODES.sendUncertain }).kind).toBe("uncertain");
});

it("retains authoritative rejection messages and fallback messages", () => {
  const body = { status: "rejected", code: "bad_request", message: "Fix the answer" };
  expect(sendOutcome(400, body)).toEqual({
    kind: "rejected",
    code: "bad_request",
    message: "Fix the answer",
  });
  expect(respondOutcome(400, body)).toEqual({ kind: "rejected", message: "Fix the answer" });
  expect(sendOutcome(400, null)).toMatchObject({
    kind: "rejected",
    message: "The message was not sent (400).",
  });
  expect(respondOutcome(400, null)).toEqual({
    kind: "rejected",
    message: "The answer was not sent (400).",
  });
});
