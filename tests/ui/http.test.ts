import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  ApiError,
  fetchBootstrap,
  fetchIdentity,
  getJson,
  postJson,
  requestReload,
  requestStop,
  respondToPrompt,
  sendMessage,
  type SendContext,
} from "../../ui/src/api";
import { API, HEADERS, LIMITS } from "../../ui/src/shared";

const context: SendContext = {
  sessionId: "session-id",
  csrfToken: "test-csrf",
  generation: "provider-generation",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uses provider-relative reads without cache and preserves cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await expect(getJson("api/resource", controller.signal)).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledWith("./api/resource", {
    cache: "no-cache",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal: controller.signal,
  });

  const abort = new Error("aborted");
  fetch.mockRejectedValue(abort);
  controller.abort();
  await expect(getJson("api/resource", controller.signal)).rejects.toBe(abort);
  await expect(postJson(context, "api/resource", {}, controller.signal)).rejects.toBe(abort);
});

it("posts protected JSON and retains non-success response bodies", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ code: "bad_request" }, { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  const body = { sessionId: context.sessionId, requestId: "request-id", text: "Hello" };
  await expect(postJson(context, API.send, body)).resolves.toEqual({
    status: 400,
    body: { code: "bad_request" },
  });
  expect(fetch).toHaveBeenCalledWith(`./${API.send}`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      [HEADERS.csrf]: context.csrfToken,
      [HEADERS.generation]: context.generation,
    },
    body: JSON.stringify(body),
    signal: undefined,
  });
});

it("distinguishes HTTP failures, invalid JSON and network failures", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValueOnce(Response.json({ code: "denied", message: "No" }, { status: 403 }));
  await expect(getJson(API.bootstrap)).rejects.toMatchObject({
    kind: "http",
    httpStatus: 403,
    code: "denied",
    message: "No",
  });
  fetch.mockResolvedValueOnce(new Response("unreadable"));
  await expect(getJson(API.bootstrap)).rejects.toMatchObject({ kind: "invalid_response" });
  fetch.mockResolvedValueOnce(new Response("unreadable", { status: 502 }));
  await expect(postJson(context, API.send, {})).resolves.toEqual({ status: 502, body: null });
  fetch.mockRejectedValue(new Error("offline"));
  await expect(getJson(API.bootstrap)).rejects.toBeInstanceOf(ApiError);
  await expect(postJson(context, API.send, {})).rejects.toMatchObject({ kind: "network" });
});

it("validates identity and bootstrap after transport parsing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(Response.json({}))),
  );
  await expect(fetchBootstrap()).rejects.toMatchObject({ kind: "invalid_response" });
  await expect(fetchIdentity()).rejects.toMatchObject({ kind: "invalid_response" });
});

it("sends explicit answers with exact request identity and never retries network failures", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const response = { kind: "permission", decision: "deny" } as const;
  await expect(respondToPrompt(context, "prompt-id", response)).resolves.toMatchObject({
    kind: "uncertain",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, init] = fetch.mock.calls[0]!;
  expect(init.body).toBe(
    JSON.stringify({ sessionId: context.sessionId, requestId: "prompt-id", response }),
  );

  await expect(sendMessage(context, "send-id", "Hello")).resolves.toMatchObject({
    kind: "uncertain",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("bounds prompt answers with a timeout and clears the timer", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const answer = respondToPrompt(context, "prompt-id", { kind: "permission", decision: "deny" });
  await vi.advanceTimersByTimeAsync(LIMITS.respondTimeoutMs + 10000);
  await expect(answer).resolves.toMatchObject({ kind: "uncertain" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("retains reload and stop outcomes through the public facade", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: "scheduled" }))
    .mockResolvedValueOnce(Response.json({ status: "stopped" }));
  vi.stubGlobal("fetch", fetch);
  await expect(requestReload(context)).resolves.toEqual({ kind: "scheduled" });
  await expect(requestStop(context)).resolves.toEqual({ kind: "stopped" });
});
