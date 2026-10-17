import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { createGateway } from "../gateway/gateway.mts";
import type { Gateway } from "../gateway/gateway.mts";
import { CONTRACT_VERSION, IDENTITY_APP } from "../extension-src/shared/contract.mts";
import { buildProviderState, writeProviderState } from "../extension-src/shared/runtime-state.mts";

const CAPABILITY = `/chat-panel/${"T".repeat(43)}/`;
const GENERATION = "generation-aaaaaaaaaaaa";

let dir: string;
let statePath: string;
let provider: http.Server;
let gateway: Gateway;
let gatewayPort: number;
let upstreamPaths: string[];

// Plain http request so tests can set Host and Origin freely (fetch forbids it).
function call(path: string, headers: http.OutgoingHttpHeaders = {}, method = "GET", body?: string) {
  return new Promise<{ status: number; json: () => any }>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: gatewayPort,
        path,
        method,
        agent: false,
        headers: { host: `127.0.0.1:${gatewayPort}`, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: response.statusCode ?? 0, json: () => JSON.parse(text) });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function publish(generation: string) {
  const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  writeProviderState(
    statePath,
    buildProviderState({ generation, origin, capabilityPath: CAPABILITY }),
  );
}

const send = (generation?: string) =>
  call(
    "/api/send",
    {
      "content-type": "application/json",
      origin: `http://127.0.0.1:${gatewayPort}`,
      ...(generation ? { "x-provider-generation": generation } : {}),
    },
    "POST",
    "{}",
  );

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "canvas-starter-gateway-"));
  statePath = join(dir, "provider.json");
  upstreamPaths = [];
  provider = http.createServer((request, response) => {
    const path = request.url ?? "";
    if (path.endsWith("api/identity")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          app: IDENTITY_APP,
          contractVersion: CONTRACT_VERSION,
          generation: GENERATION,
        }),
      );
    } else {
      upstreamPaths.push(path);
      response.writeHead(200).end("ok");
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  gateway = createGateway({ port: 0, statePath });
  gatewayPort = (await gateway.listen()).port;
});

afterEach(async () => {
  await gateway.close();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

it("answers not_connected when no provider state exists", async () => {
  const reply = await call("/api/bootstrap");
  expect(reply.status).toBe(503);
  expect(reply.json().code).toBe("not_connected");
});

it("answers not_connected when the state file generation is not the live one", async () => {
  publish("generation-bbbbbbbbbbbb");
  expect((await call("/api/bootstrap")).status).toBe(503);
  expect(upstreamPaths).toEqual([]);
});

it("forwards allow-listed paths to the provider capability path", async () => {
  publish(GENERATION);
  expect((await call("/api/bootstrap")).status).toBe(200);
  expect(upstreamPaths).toEqual([`${CAPABILITY}api/bootstrap`]);
});

it("refuses a stale or missing generation on send and never forwards it", async () => {
  publish(GENERATION);
  for (const reply of [await send("generation-old-0000000"), await send()]) {
    expect(reply.status).toBe(409);
    expect(reply.json().code).toBe("stale_provider");
  }
  expect(upstreamPaths).toEqual([]);
  expect((await send(GENERATION)).status).toBe(200);
});

it("rejects a bad Host or Origin with 403", async () => {
  publish(GENERATION);
  expect((await call("/api/bootstrap", { host: "evil.example.test" })).status).toBe(403);
  expect((await call("/api/bootstrap", { origin: "https://evil.example.test" })).status).toBe(403);
  expect(
    (await call("/api/send", { "content-type": "application/json" }, "POST", "{}")).status,
  ).toBe(403);
  expect(upstreamPaths).toEqual([]);
});

it("returns 404 for paths outside the allow-list", async () => {
  publish(GENERATION);
  for (const path of ["/api/other", "/assets/../api/send", `${CAPABILITY}api/bootstrap`]) {
    expect((await call(path)).status).toBe(404);
  }
  expect(upstreamPaths).toEqual([]);
});
