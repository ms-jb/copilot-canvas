import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { AddressInfo } from "node:net";
import {
  CONTRACT_VERSION,
  IDENTITY_APP,
  type PendingPrompt,
  type SessionStatus,
} from "../extension-src/shared/contract.mts";
import { buildProviderState, writeProviderState } from "../extension-src/shared/runtime-state.mts";
import { createGateway } from "../gateway/gateway.mts";
import type { Gateway } from "../gateway/gateway.mts";
import {
  createNotifier,
  createPresence,
  isAllowedPushEndpoint,
  openPushStore,
  parseSse,
} from "../gateway/push.mts";

const APPLE = "https://web.push.apple.com/QGuQyavXutnMH4b";
const FCM = "https://fcm.googleapis.com/fcm/send/abc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canvas-push-"));
  sent.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("accepts only https endpoints on known push services", () => {
  for (const ok of [APPLE, FCM, "https://updates.push.services.mozilla.com/wpush/v2/x"]) {
    expect(isAllowedPushEndpoint(ok)).toBe(true);
  }
  for (const bad of [
    "http://web.push.apple.com/x",
    "https://evilpush.apple.com/x",
    "https://push.apple.com.evil.test/x",
    "https://web.push.apple.com:8443/x",
    "https://user:pass@web.push.apple.com/x",
    "https://example.com/x",
    "not a url",
    42,
  ]) {
    expect(isAllowedPushEndpoint(bad)).toBe(false);
  }
});

it("signs a VAPID token the public key verifies, and caches it per push service", async () => {
  const calls: string[] = [];
  const store = openPushStore(join(dir, "push.json"), async (_endpoint, authorization) => {
    calls.push(authorization);
    return 201;
  });
  store.add(APPLE);
  expect(await store.sendAll()).toBe(1);
  expect(await store.sendAll()).toBe(1);
  expect(calls[0]).toBe(calls[1]);

  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(calls[0] ?? "");
  expect(match?.[4]).toBe(store.publicKey);
  const [, header = "", claims = "", signature = ""] = match ?? [];
  const point = Buffer.from(store.publicKey, "base64url");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  const signed = Buffer.from(`${header}.${claims}`);
  const valid = verify(
    "sha256",
    signed,
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  expect(valid).toBe(true);
  expect(JSON.parse(Buffer.from(claims, "base64url").toString()).aud).toBe(
    "https://web.push.apple.com",
  );
});

it("keeps keys across restarts and drops subscriptions the push service reports gone", async () => {
  const path = join(dir, "push.json");
  const first = openPushStore(path, async () => 410);
  first.add(APPLE);
  first.add(FCM);
  const again = openPushStore(path, async (endpoint) => (endpoint === APPLE ? 410 : 201));
  expect(again.publicKey).toBe(first.publicKey);
  expect(await again.sendAll()).toBe(1);
  expect(again.endpoints()).toEqual([FCM]);
});

it("treats a device as focused until it reports otherwise or its report lapses", () => {
  const presence = createPresence(1000);
  expect(presence.isFocused(APPLE, 0)).toBe(false);
  presence.report(APPLE, true, 0);
  expect(presence.isFocused(APPLE, 999)).toBe(true);
  expect(presence.isFocused(FCM, 999)).toBe(false);
  expect(presence.isFocused(APPLE, 1000)).toBe(false);
  presence.report(APPLE, true, 2000);
  presence.report(APPLE, false, 2100);
  expect(presence.isFocused(APPLE, 2200)).toBe(false);
  presence.report(APPLE, true, 3000);
  presence.forget(APPLE);
  expect(presence.isFocused(APPLE, 3100)).toBe(false);
});

it("skips the subscriptions a filter excludes", async () => {
  const store = openPushStore(join(dir, "push.json"), async (endpoint) => {
    sent.push(endpoint);
    return 201;
  });
  store.add(APPLE);
  store.add(FCM);
  expect(await store.sendAll((endpoint) => endpoint === APPLE)).toBe(1);
  expect(sent).toEqual([FCM]);
});

const waiting = (waitingFor: SessionStatus["waitingFor"]): SessionStatus => ({
  phase: "waiting",
  waitingFor,
});
const prompt = (requestId: string) => ({ requestId, kind: "permission" }) as PendingPrompt;

it("notifies once per new request, on finish, and never again on reconnect", () => {
  const notifier = createNotifier("Atlas");
  expect(notifier.snapshot("gen-1", { phase: "idle" }, [], 0)).toBeNull();
  expect(notifier.status({ phase: "working" }, 10)).toBeNull();
  expect(notifier.status(waiting("permission"), 20)?.body).toBe("Waiting for your permission.");
  // The matching prompt arrives a moment later: same request, no second buzz.
  expect(notifier.prompts([prompt("r1")], 30)).toBeNull();
  // Reconnecting to the same run repeats nothing.
  expect(notifier.snapshot("gen-1", waiting("permission"), [prompt("r1")], 10_000)).toBeNull();
  // A second request of the same kind still notifies.
  expect(notifier.prompts([prompt("r1"), prompt("r2")], 20_000)?.title).toBe("Atlas needs you");
  expect(notifier.status({ phase: "working" }, 30_000)).toBeNull();
  expect(notifier.status({ phase: "idle" }, 40_000)?.title).toBe("Atlas finished");
});

it("notifies for a request already waiting when a new provider run is first seen", () => {
  const notifier = createNotifier("Copilot");
  expect(notifier.snapshot("gen-2", waiting("plan"), [], 0)?.body).toBe(
    "Has a plan ready for you to review.",
  );
});

it("parses complete SSE frames and keeps the remainder", () => {
  const { frames, rest } = parseSse(': keepalive\n\nevent: status\ndata: {"a":1}\n\nevent: pro');
  expect(frames).toEqual([{ event: "status", data: '{"a":1}' }]);
  expect(rest).toBe("event: pro");
});

let gateway: Gateway;
let port: number;
const sent: string[] = [];

async function startGateway() {
  gateway = createGateway({
    port: 0,
    sessionsDir: join(dir, "sessions"),
    push: {
      statePath: join(dir, "push.json"),
      assistantName: "Atlas",
      sender: async (endpoint) => {
        sent.push(endpoint);
        return 201;
      },
    },
  });
  port = (await gateway.listen()).port;
}

function call(path: string, method = "GET", body?: unknown) {
  return new Promise<{ status: number; type: string; text: string }>((done, fail) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(payload && { "content-type": "application/json" }),
          ...(method === "POST" && { origin: `http://127.0.0.1:${port}` }),
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          done({
            status: response.statusCode ?? 0,
            type: response.headers["content-type"] ?? "",
            text,
          }),
        );
      },
    );
    request.on("error", fail);
    request.end(payload);
  });
}

it("serves the service worker, key and latest notice, and validates subscriptions", async () => {
  await startGateway();
  try {
    const worker = await call("/sw.js");
    expect(worker.status).toBe(200);
    expect(worker.type).toMatch(/javascript/);

    expect(JSON.parse((await call("/api/push/key")).text).publicKey).toMatch(/^[\w-]{80,}$/);
    expect(JSON.parse((await call("/api/push/latest")).text).title).toBe("Atlas");

    expect(
      (await call("/api/push/subscribe", "POST", { endpoint: "https://example.com/x" })).status,
    ).toBe(400);
    expect((await call("/api/push/subscribe", "GET")).status).toBe(405);
    expect((await call("/api/push/subscribe", "POST", { endpoint: APPLE })).status).toBe(200);

    expect(
      (await call("/api/push/presence", "POST", { endpoint: FCM, focused: true })).status,
    ).toBe(400);
    expect(
      (await call("/api/push/presence", "POST", { endpoint: APPLE, focused: "yes" })).status,
    ).toBe(400);
    expect(
      (await call("/api/push/presence", "POST", { endpoint: APPLE, focused: true })).status,
    ).toBe(200);

    // A test is asked for from the open app, so it ignores focus.
    expect((await call("/api/push/test", "POST", {})).status).toBe(200);
    expect(sent).toEqual([APPLE]);
    expect((await call("/api/push/test", "POST", {})).status).toBe(400);
    expect(JSON.parse((await call("/api/push/latest")).text).body).toBe("Notifications are on.");

    expect((await call("/api/push/unsubscribe", "POST", { endpoint: APPLE })).status).toBe(200);
    expect((await call("/api/push/key", "POST", {})).status).toBe(405);
    expect((await call("/toString")).status).toBe(404);
  } finally {
    await gateway.close();
  }
});

it("pushes when the live provider starts waiting on the user", async () => {
  const generation = "generation-push-aaaa";
  const capabilityPath = `/chat-panel/${"P".repeat(43)}/`;
  let events: http.ServerResponse | undefined;
  const provider = http.createServer((request, response) => {
    if (request.url === `${capabilityPath}api/identity`) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ app: IDENTITY_APP, contractVersion: CONTRACT_VERSION, generation }),
      );
    } else if (request.url === `${capabilityPath}api/events`) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const snapshot = { entries: [], status: { phase: "working" }, prompts: [] };
      response.write(
        `event: snapshot\ndata: ${JSON.stringify({ seq: 1, generation, snapshot })}\n\n`,
      );
      events = response;
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  writeProviderState(
    join(dir, "sessions", "session-a.json"),
    buildProviderState({ generation, origin, capabilityPath, sessionId: "session-a" }),
  );
  await startGateway();
  const until = async (ready: () => boolean) => {
    for (let waited = 0; !ready() && waited < 8000; waited += 50) {
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  try {
    await call("/api/push/subscribe", "POST", { endpoint: APPLE });
    await call("/api/push/subscribe", "POST", { endpoint: FCM });
    // The phone with the app in front is skipped; the other device still hears about it.
    await call("/api/push/presence", "POST", { endpoint: FCM, focused: true });
    await until(() => events !== undefined);
    const status = { phase: "waiting", waitingFor: "permission" };
    events?.write(`event: status\ndata: ${JSON.stringify({ seq: 2, status })}\n\n`);
    await until(() => sent.length > 0);
    expect(sent).toEqual([APPLE]);
    expect(JSON.parse((await call("/api/push/latest")).text)).toEqual({
      title: "Atlas needs you",
      body: "Waiting for your permission.",
    });
  } finally {
    await gateway.close();
    provider.closeAllConnections();
    await new Promise((done) => provider.close(done));
  }
}, 15_000);

it("has no push routes when notifications are off", async () => {
  gateway = createGateway({ port: 0, sessionsDir: dir });
  port = (await gateway.listen()).port;
  try {
    expect((await call("/sw.js")).status).toBe(404);
    expect((await call("/api/push/key")).status).toBe(404);
  } finally {
    await gateway.close();
  }
});
