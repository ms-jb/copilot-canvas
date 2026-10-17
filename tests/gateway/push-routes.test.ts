import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { beforeEach, expect, it } from "vite-plus/test";
import { CONTRACT_VERSION, IDENTITY_APP } from "../../extension-src/shared/contract.mts";
import {
  buildProviderState,
  writeProviderState,
} from "../../extension-src/shared/runtime-state.mts";
import { createGateway } from "../../gateway/gateway.mts";
import type { Gateway } from "../../gateway/gateway.mts";
import { APPLE, FCM, usePushDirectory } from "./fixtures.mts";

const directory = usePushDirectory();
let gateway: Gateway;
let port: number;
const sent: string[] = [];
beforeEach(() => {
  sent.length = 0;
});

async function startGateway() {
  gateway = createGateway({
    port: 0,
    sessionsDir: join(directory(), "sessions"),
    push: {
      statePath: join(directory(), "push.json"),
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
    join(directory(), "sessions", "session-a.json"),
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
  gateway = createGateway({ port: 0, sessionsDir: directory() });
  port = (await gateway.listen()).port;
  try {
    expect((await call("/sw.js")).status).toBe(404);
    expect((await call("/api/push/key")).status).toBe(404);
  } finally {
    await gateway.close();
  }
});
