import { execFile } from "node:child_process";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createGateway } from "../../gateway/gateway.mts";
import type { Gateway } from "../../gateway/gateway.mts";
import { isLocalToolRequest, parseNotice } from "../../gateway/server/notify-route.mts";
import { allowedMethod } from "../../gateway/server/request-policy.mts";
import { APPLE, FCM, usePushDirectory } from "./fixtures.mts";

const directory = usePushDirectory();
const tokenPath = () => join(directory(), "notify-token");
const token = () => readFileSync(tokenPath(), "utf8").trim();

async function startGateway(options: { notify?: boolean; status?: number } = {}) {
  const sent: string[] = [];
  const gateway: Gateway = createGateway({
    port: 0,
    sessionsDir: join(directory(), "sessions"),
    push: {
      statePath: join(directory(), "push.json"),
      assistantName: "Atlas",
      notifyTokenPath: options.notify === false ? undefined : tokenPath(),
      sender: async (endpoint) => {
        sent.push(endpoint);
        return options.status ?? 201;
      },
    },
  });
  const { port } = await gateway.listen();
  return { gateway, port, sent };
}

function call(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((done, fail) => {
    const payload =
      typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "POST",
        agent: false,
        headers: { "content-type": "application/json", ...options.headers },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, json: JSON.parse(text) }),
        );
      },
    );
    request.on("error", fail);
    request.end(options.method === "GET" ? undefined : payload);
  });
}

const notify = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  call(port, "/api/push/notify", {
    body,
    headers: { authorization: `Bearer ${token()}`, ...headers },
  });

async function subscribe(port: number, endpoint: string) {
  const origin = { origin: `http://127.0.0.1:${port}` };
  expect(
    (await call(port, "/api/push/subscribe", { body: { endpoint }, headers: origin })).status,
  ).toBe(200);
}

it("creates a private token at start, keeps it, and replaces one that isn't private", async () => {
  const first = await startGateway();
  await first.gateway.close();
  expect(token()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
  const kept = token();

  await (await startGateway()).gateway.close();
  expect(token()).toBe(kept);

  chmodSync(tokenPath(), 0o644);
  await (await startGateway()).gateway.close();
  expect(token()).not.toBe(kept);
  expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
});

it("pushes an authorized notice to every device, focused or not, and serves it as latest", async () => {
  const { gateway, port, sent } = await startGateway();
  try {
    await subscribe(port, APPLE);
    await subscribe(port, FCM);
    const origin = { origin: `http://127.0.0.1:${port}` };
    await call(port, "/api/push/presence", {
      body: { endpoint: APPLE, focused: true },
      headers: origin,
    });

    const reply = await notify(port, {
      title: " Reminder ",
      body: "Take out the bins.",
      url: "/?view=chat",
    });
    expect(reply).toEqual({ status: 200, json: { ok: true, sent: 2, failed: 0 } });
    expect(sent.sort()).toEqual([APPLE, FCM].sort());

    const latest = await call(port, "/api/push/latest", { method: "GET" });
    expect(latest.json).toMatchObject({
      title: "Reminder",
      body: "Take out the bins.",
      url: "/?view=chat",
    });
    expect(latest.json.tag).toMatch(/^notice-[\w-]+$/);
    expect(JSON.stringify(latest.json)).not.toContain(token());
  } finally {
    await gateway.close();
  }
});

it("reports failed deliveries", async () => {
  const { gateway, port } = await startGateway({ status: 500 });
  try {
    await subscribe(port, APPLE);
    expect((await notify(port, { title: "a", body: "b" })).json).toMatchObject({
      sent: 0,
      failed: 1,
    });
  } finally {
    await gateway.close();
  }
});

it("rejects requests without the token or that look like a browser or the tunnel", async () => {
  const { gateway, port, sent } = await startGateway();
  try {
    await subscribe(port, APPLE);
    const notice = { title: "t", body: "b" };
    const path = "/api/push/notify";
    expect((await call(port, path, { body: notice })).status).toBe(403);
    expect(
      (await call(port, path, { body: notice, headers: { authorization: "Bearer nope" } })).status,
    ).toBe(403);
    expect(
      (await call(port, path, { body: notice, headers: { authorization: token() } })).status,
    ).toBe(403);
    const foreign: Record<string, string>[] = [
      { origin: `http://127.0.0.1:${port}` },
      { "x-forwarded-for": "203.0.113.9" },
      { "x-forwarded-host": "abc-47600.usw2.devtunnels.ms" },
      { "x-ms-client-principal": "owner" },
      { "sec-fetch-site": "same-origin" },
      { cookie: "a=b" },
      { host: "evil.example" },
    ];
    for (const headers of foreign) {
      expect((await notify(port, notice, headers)).status).toBe(403);
    }
    expect((await call(port, path, { method: "GET" })).status).toBe(405);
    expect((await notify(port, notice, { "content-type": "text/plain" })).status).toBe(415);
    expect((await notify(port, "{oops")).status).toBe(400);
    expect((await notify(port, { title: "t", body: "x".repeat(5000) })).status).toBe(413);
    expect((await notify(port, { title: "t" })).status).toBe(400);
    expect(sent).toEqual([]);
  } finally {
    await gateway.close();
  }
});

it("rejects loopback-only checks from other addresses", () => {
  const request = (remoteAddress: string, headers: Record<string, string> = {}) =>
    ({
      socket: { remoteAddress },
      headers: { host: "127.0.0.1:47600", ...headers },
    }) as unknown as IncomingMessage;
  expect(isLocalToolRequest(request("127.0.0.1"), 47600)).toBe(true);
  expect(isLocalToolRequest(request("::1"), 47600)).toBe(true);
  expect(isLocalToolRequest(request("::ffff:127.0.0.1"), 47600)).toBe(true);
  expect(isLocalToolRequest(request("10.0.0.10"), 47600)).toBe(false);
  expect(isLocalToolRequest(request("127.0.0.1", { forwarded: "for=1.2.3.4" }), 47600)).toBe(false);
});

it("validates the notice", () => {
  expect(parseNotice({ title: "t", body: "b" })).toEqual({ title: "t", body: "b" });
  expect(parseNotice({ title: "t", body: "b", url: "https://example.com/x" })).toMatchObject({
    url: "https://example.com/x",
  });
  for (const value of [
    null,
    [],
    { title: "x".repeat(81), body: "b" },
    { title: "t", body: "x".repeat(301) },
    { title: " ", body: "b" },
    { title: "t\u0007", body: "b" },
    { title: "t", body: "line\nbreak" },
    { title: "t", body: "\u202Eevil" },
    { title: 1, body: "b" },
    { title: "t", body: "b", extra: 1 },
    { title: "t", body: "b", url: "javascript:alert(1)" },
    { title: "t", body: "b", url: "//evil.example/x" },
    { title: "t", body: "b", url: "/\\evil.example" },
    { title: "t", body: "b", url: "relative" },
    { title: "t", body: "b", url: `/${"x".repeat(500)}` },
  ]) {
    expect(typeof parseNotice(value)).toBe("string");
  }
  expect(
    parseNotice({ title: "x".repeat(80), body: "x".repeat(300), url: `/${"x".repeat(499)}` }),
  ).not.toBeTypeOf("string");
});

it("is not a proxied route and is off without a token file", async () => {
  expect(allowedMethod("/api/push/notify")).toBeUndefined();
  const { gateway, port } = await startGateway({ notify: false });
  try {
    const reply = await call(port, "/api/push/notify", { headers: { authorization: "Bearer x" } });
    expect(reply.status).toBe(404);
  } finally {
    await gateway.close();
  }
});

function runCli(port: number, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      process.execPath,
      [join(process.cwd(), "scripts", "notify.mts"), ...args],
      { env: { ...process.env, CANVAS_RUNTIME_DIR: directory(), GATEWAY_PORT: String(port) } },
      (error, stdout, stderr) =>
        done({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

it("CLI prints the result and exits non-zero when nothing was sent or the call fails", async () => {
  const { gateway, port } = await startGateway();
  try {
    expect((await runCli(port, ["only-title"])).code).toBe(2);

    const none = await runCli(port, ["Hello", "World"]);
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout)).toEqual({ sent: 0, failed: 0 });

    await subscribe(port, APPLE);
    const ok = await runCli(port, ["Hello", "World", "/"]);
    expect(ok).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(ok.stdout)).toEqual({ sent: 1, failed: 0 });

    const real = token();
    writeFileSync(tokenPath(), `${"A".repeat(43)}\n`, { mode: 0o600 });
    const refused = await runCli(port, ["Hello", "World"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/refused/);
    expect(refused.stderr + refused.stdout).not.toContain(real);
    expect(refused.stderr + refused.stdout).not.toContain("A".repeat(43));
  } finally {
    await gateway.close();
  }
  const down = await runCli(port, ["Hello", "World"]);
  expect(down.code).toBe(1);
  expect(down.stderr).toMatch(/not reachable/);
});
