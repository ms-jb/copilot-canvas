// Push a notice to every subscribed phone through the running gateway.
// Usage: npm run notify -- "<title>" "<body>" [url]
//
// Reads the gateway's private notify token from the runtime folder and calls it on loopback.
// Prints {"sent":N,"failed":M}; exits 1 when nothing was delivered or the call failed.

import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, notifyTokenPath } from "../src/shared/node/config.mts";
import { readNotifyToken } from "../src/shared/node/notify-token.mts";
import { NOTIFY_PATH } from "../gateway/server/notify-route.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 20_000;

function fail(message: string, code = 1): never {
  console.error(`notify: ${message}`);
  process.exit(code);
}

function post(port: number, token: string, payload: string) {
  return new Promise<{ status: number; text: string }>((done, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: NOTIFY_PATH,
        method: "POST",
        agent: false,
        timeout: TIMEOUT_MS,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () => done({ status: response.statusCode ?? 0, text }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end(payload);
  });
}

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
  fail('usage: npm run notify -- "<title>" "<body>" [url]', 2);
}
const [title, body, url] = args;
const config = loadConfig(repoRoot);
const token = readNotifyToken(notifyTokenPath(config));
if (!token) {
  fail("no private notify token. Start the gateway with notifications on (npm run phone).");
}

let reply: { status: number; text: string };
try {
  reply = await post(config.gatewayPort, token, JSON.stringify({ title, body, url }));
} catch (error) {
  fail(`gateway not reachable on 127.0.0.1:${config.gatewayPort} (${(error as Error).message}).`);
}
let result: { sent?: unknown; failed?: unknown; message?: unknown } = {};
try {
  result = JSON.parse(reply.text);
} catch {
  // Reported below with the status code.
}
if (reply.status === 403) fail("the gateway refused the notify token. Restart the gateway.");
if (reply.status !== 200 || typeof result.sent !== "number") {
  const detail = typeof result.message === "string" ? result.message : "unexpected reply";
  fail(`gateway answered ${reply.status}: ${detail}`);
}
console.log(JSON.stringify({ sent: result.sent, failed: result.failed ?? 0 }));
if (result.sent === 0) fail("no device received the notice.");
