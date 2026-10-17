import { request } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Bridge } from "../../src/host/bridge.mts";
import { createProviderServer } from "../../src/host/server.mts";
import type { ProviderServer } from "../../src/host/server.mts";
import { API, ERROR_CODES, HEADERS } from "../../src/shared/contract.mts";

let server: ProviderServer;
let bridge: Bridge;
let effects: ReturnType<typeof vi.fn>[];
const controls = {
  available: { mode: false, model: false, reasoningEffort: false, contextTier: false },
  models: [],
};
const posts = [
  [API.send, { requestId: "request-1", text: "hello" }],
  [API.controls, { change: { mode: "plan" } }],
  [API.respond, { requestId: "p", response: { kind: "permission", decision: "deny" } }],
  [API.reload, {}],
  [API.stop, {}],
] as const;

beforeEach(async () => {
  const actions = {
    send: vi.fn<Bridge["send"]>(async (_text, requestId) => ({
      ok: true,
      status: "accepted",
      requestId,
    })),
    applyControl: vi.fn<Bridge["applyControl"]>(async () => controls),
    reloadExtensions: vi.fn<Bridge["reloadExtensions"]>(() => true),
    stop: vi.fn<Bridge["stop"]>(async () => "stopped"),
    respond: vi.fn<Bridge["respond"]>(async () => ({ ok: true, status: "accepted" })),
  };
  effects = Object.values(actions);
  bridge = {
    ...actions,
    sessionId: "session-1",
    getSnapshot: () => ({ seq: 0, snapshot: { entries: [], status: { phase: "idle" } }, controls }),
    subscribe: () => () => {},
    refreshPrompts: () => {},
  };
  server = await createProviderServer({
    config: { canvasId: "test", assistantName: "Test", description: "Test", defaultView: "chat" },
    bridge,
    csrfToken: "csrf",
    generation: "generation",
    token: "capability",
  }).start();
});
afterEach(async () => {
  await server.close();
});

function post(path: string, body: unknown, headers: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    host: `127.0.0.1:${server.port}`,
    origin: server.origin,
    "content-type": "application/json",
    [HEADERS.csrf]: server.csrfToken,
    [HEADERS.generation]: server.generation,
    ...headers,
  };
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request(
      server.url + path,
      {
        method: "POST",
        headers: Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)),
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

it.each(posts)("guards every %s POST before dispatch", async (path, fields) => {
  const body = { sessionId: bridge.sessionId, ...fields };
  const refusals: [Record<string, string | undefined>, string][] = [
    [{ host: "evil.test" }, ERROR_CODES.forbidden],
    [{ origin: "https://evil.test" }, ERROR_CODES.forbidden],
    [{ origin: undefined }, ERROR_CODES.forbidden],
    [{ [HEADERS.csrf]: "wrong" }, ERROR_CODES.forbidden],
    [{ [HEADERS.csrf]: undefined }, ERROR_CODES.forbidden],
    [{ [HEADERS.generation]: "old" }, ERROR_CODES.staleProvider],
  ];
  for (const [headers, code] of refusals) {
    expect((await post(path, body, headers)).body).toMatchObject({ ok: false, code });
  }
  expect((await post(path, { ...body, sessionId: "another-session" })).body).toMatchObject({
    ok: false,
    code: ERROR_CODES.sessionMismatch,
  });
  for (const fn of effects) {
    expect(fn).not.toHaveBeenCalled();
  }
  expect((await post(path, body)).body).toMatchObject({ ok: true });
});
