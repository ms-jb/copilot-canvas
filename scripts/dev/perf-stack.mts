// A real provider (built renderer + host HTTP server) behind a real gateway, with a fake session that
// holds a long conversation, for measuring the phone path without Copilot or a tunnel:
//
//   node scripts/dev/perf-stack.mts [--entries 500] [--port 47690] [--stream]
//
// It serves extension/ui (run `npm run build` first) and prints the gateway URL as JSON. `--stream`
// streams a long reply every few seconds. Runtime files go to .perf/runtime in this checkout (it is
// git-ignored); push has no subscriber, so nothing is ever sent. The body bytes the gateway sends are
// counted at http://127.0.0.1:<port + 1>/bytes.
import { mkdirSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createSessionBridge } from "../../src/host/bridge.mts";
import { createProviderServer } from "../../src/host/server.mts";
import type { SessionEventLike } from "../../src/shared/transcript.mts";
import { buildProviderState, writeProviderState } from "../../src/shared/node/runtime-state.mts";
import { createGateway } from "../../gateway/gateway.mts";
import { LONG_REPLY, longHistory } from "./long-fixture.mts";

const { values } = parseArgs({
  options: {
    entries: { type: "string", default: "500" },
    port: { type: "string", default: "47690" },
    stream: { type: "boolean", default: false },
  },
});
const root = resolve(import.meta.dirname, "../..");
const runtime = join(root, ".perf", "runtime");
mkdirSync(runtime, { recursive: true, mode: 0o700 });

const listeners = new Set<(event: SessionEventLike) => void>();
const emit = (event: SessionEventLike) => {
  for (const listener of listeners) listener(event);
};
let counter = 0;
const session = {
  sessionId: "perf-session",
  on(listener: (event: SessionEventLike) => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  // The history ends idle, so the activity row is at rest, as it usually is.
  getEvents: async () => [
    ...longHistory(Number(values.entries)),
    { id: "perf-idle-0", type: "assistant.idle", timestamp: new Date().toISOString() },
  ],
  send: async () => `perf-send-${++counter}`,
};
const bridge = createSessionBridge(session);
await bridge.ready;

const provider = await createProviderServer({
  config: {
    canvasId: "perf-stack",
    assistantName: "Copilot",
    description: "Perf",
    defaultView: "chat",
  },
  bridge,
  uiDir: join(root, "extension", "ui"),
}).start();
const statePath = join(runtime, `provider-${values.port}.json`);
writeProviderState(
  statePath,
  buildProviderState({
    generation: provider.generation,
    origin: provider.origin,
    capabilityPath: provider.capabilityPath,
    sessionId: session.sessionId,
  }),
);
// Push on (with no subscriber, nothing is ever sent) so the gateway serves its service worker.
const gateway = createGateway({
  port: Number(values.port),
  statePath,
  push: { statePath: join(runtime, `push-${values.port}.json`), assistantName: "Copilot" },
});
const { port } = await gateway.listen();

// Bytes the gateway writes (headers and body), including the service worker's own fetches, which
// the page can't see. Browsers don't pipeline, so a socket's growth during a response is its size.
let sent = 0;
gateway.server.on("request", (request: http.IncomingMessage, response: http.ServerResponse) => {
  const { socket } = request;
  const start = socket.bytesWritten;
  response.on("close", () => {
    sent += socket.bytesWritten - start;
  });
});
const bytesServer = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ bytes: sent }));
});
await new Promise<void>((done) => bytesServer.listen(port + 1, "127.0.0.1", done));
console.log(
  JSON.stringify({
    gateway: `http://127.0.0.1:${port}/`,
    provider: provider.url,
    bytes: `http://127.0.0.1:${port + 1}/bytes`,
  }),
);

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** One turn like Copilot's: a prompt, a reply in small deltas, the final message, then idle. */
async function streamTurn() {
  const turn = ++counter;
  const stamp = () => new Date().toISOString();
  emit({
    id: `perf-user-${turn}`,
    type: "user.message",
    timestamp: stamp(),
    data: { messageId: `perf-user-${turn}`, content: `Streaming turn ${turn}` },
  });
  const messageId = `perf-reply-${turn}`;
  for (let index = 0; index < LONG_REPLY.length; index += 8) {
    emit({
      id: `perf-delta-${turn}-${index}`,
      type: "assistant.message_delta",
      timestamp: stamp(),
      data: { messageId, deltaContent: LONG_REPLY.slice(index, index + 8) },
    });
    await sleep(10);
  }
  emit({
    id: `perf-final-${turn}`,
    type: "assistant.message",
    timestamp: stamp(),
    data: { messageId, content: LONG_REPLY },
  });
  emit({ id: `perf-idle-${turn}`, type: "assistant.idle", timestamp: stamp() });
}

let running = true;
const stop = async () => {
  running = false;
  bytesServer.close();
  await gateway.close();
  await provider.close();
  bridge.dispose();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
while (running && values.stream) {
  await sleep(3000);
  await streamTurn();
}
