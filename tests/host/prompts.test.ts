import { afterEach, expect, it, vi } from "vite-plus/test";
import { createPromptService } from "../../src/host/prompts.mts";
import { ERROR_CODES } from "../../src/shared/contract.mts";
import { deferred, fakeSession, promptEvent } from "./fixtures";

afterEach(() => vi.useRealTimers());

it("adds supported prompt kinds from events and drops only authoritative completions", async () => {
  const answer = vi.fn(async () => ({ success: true }));
  const service = createPromptService(
    fakeSession({
      permissions: { handlePendingPermissionRequest: answer },
      ui: {
        handlePendingUserInput: answer,
        handlePendingElicitation: answer,
        handlePendingExitPlanMode: answer,
      },
    }),
  );
  await service.ready;
  const changed = vi.fn();
  service.subscribe(changed);
  const kinds = ["permission", "user_input", "elicitation", "exit_plan_mode"];
  for (const kind of kinds) service.applyEvent(promptEvent(`${kind}.requested`, kind));
  expect(service.list().map((p) => p.kind)).toEqual(["permission", "question", "form", "plan"]);
  service.applyEvent({ ...promptEvent("session.idle", ""), agentId: "child" });
  expect(service.list()).toHaveLength(4);
  for (const kind of kinds) service.applyEvent(promptEvent(`${kind}.completed`, kind));
  expect(service.list()).toEqual([]);
  service.applyEvent(promptEvent("permission.requested", "permission"));
  expect(service.list()).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(8);
  expect(answer).not.toHaveBeenCalled();
  service.dispose();
});

it("guards duplicate answers synchronously and retires a confirmed request", async () => {
  const pending = deferred<unknown>();
  const answer = vi.fn(() => pending.promise);
  const service = createPromptService(
    fakeSession({
      permissions: { handlePendingPermissionRequest: answer },
    }),
  );
  service.applyEvent(promptEvent("permission.requested", "p"));
  const response = { kind: "permission", decision: "approve" } as const;
  const first = service.respond("p", response);
  expect(await service.respond("p", response)).toMatchObject({
    code: ERROR_CODES.duplicateRequest,
  });
  pending.resolve({ success: true });
  expect(await first).toEqual({ ok: true, status: "accepted" });
  expect(answer).toHaveBeenCalledTimes(1);
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "p",
      result: { kind: "approve-once", approvedInteractively: true },
    }),
  );
  expect(service.list()).toEqual([]);
  expect(await service.respond("p", response)).toMatchObject({ code: ERROR_CODES.promptResolved });
  service.dispose();
});

it("keeps timed-out answers guarded and pending until their late confirmation", async () => {
  vi.useFakeTimers();
  const pending = deferred<unknown>();
  const answer = vi.fn(() => pending.promise);
  const service = createPromptService(
    fakeSession({
      ui: { handlePendingUserInput: answer },
    }),
    { timeoutMs: 20 },
  );
  service.applyEvent(
    promptEvent("user_input.requested", "q", { question: "Which?", choices: ["One"] }),
  );
  const response = { kind: "question", answer: "One", freeform: false } as const;
  const first = service.respond("q", response);
  await vi.advanceTimersByTimeAsync(21);
  expect(await first).toMatchObject({ status: "uncertain", code: ERROR_CODES.respondUncertain });
  expect(service.list()).toHaveLength(1);
  expect(await service.respond("q", response)).toMatchObject({
    code: ERROR_CODES.duplicateRequest,
  });
  pending.resolve({ success: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(service.list()).toEqual([]);
  expect(answer).toHaveBeenCalledTimes(1);
  service.dispose();
});

it("preserves permissions arriving during read-back and removes older absent requests", async () => {
  const pending = deferred<unknown>();
  const service = createPromptService(
    fakeSession({
      permissions: {
        handlePendingPermissionRequest: async () => ({ success: true }),
        pendingRequests: () => pending.promise,
      },
    }),
    { refreshIntervalMs: 0 },
  );
  service.applyEvent(promptEvent("permission.requested", "new"));
  pending.resolve({ items: [{ requestId: "old", request: { kind: "read", path: "a" } }] });
  await service.ready;
  expect(service.list().map((p) => p.requestId)).toEqual(["new", "old"]);
  service.applyEvent(promptEvent("session.shutdown", ""));
  expect(service.list()).toEqual([]);
  service.dispose();
});
