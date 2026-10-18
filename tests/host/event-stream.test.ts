import http from "node:http";
import { afterEach, expect, it } from "vite-plus/test";
import { createSessionBridge } from "../../src/host/bridge.mts";
import type { SessionBridge } from "../../src/host/bridge.mts";
import { createProviderServer } from "../../src/host/server.mts";
import type { ProviderServer } from "../../src/host/server.mts";
import { API, type ServerEvent } from "../../src/shared/contract.mts";
import { applyServerEvent, createViewState } from "../../src/shared/entries.mts";
import { fakeSession } from "./fixtures";

let server: ProviderServer | undefined;
let bridge: SessionBridge | undefined;
afterEach(async () => {
  await server?.close();
  bridge?.dispose();
});

const tick = () => new Promise((done) => setTimeout(done, 5));

async function start(history: { type: string; data: Record<string, unknown> }[] = []) {
  const session = fakeSession();
  session.getEvents = async () =>
    history.map((event, index) => ({
      id: `history-${index}`,
      timestamp: new Date(Date.UTC(2026, 9, 1, 12, 0, index)).toISOString(),
      ...event,
    }));
  bridge = createSessionBridge(session, { coalesceMs: 0 });
  await bridge.ready;
  server = await createProviderServer({
    config: { canvasId: "test", assistantName: "Test", description: "", defaultView: "chat" },
    bridge,
    generation: "generation",
    token: "capability",
  }).start();
  let count = 0;
  const delta = (messageId: string, deltaContent: string) => {
    session.emit({
      id: `delta-${++count}`,
      type: "assistant.message_delta",
      timestamp: "2026-10-17T12:00:00Z",
      data: { messageId, deltaContent },
    });
  };
  return { session, delta };
}

/** Opens the event stream and collects its frames as { name, data }. */
function listen(headers: Record<string, string> = {}) {
  const frames: { name: string; data: any }[] = [];
  const ids: string[] = [];
  let buffer = "";
  const request = http.get(server!.url + API.events, { headers }, (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        const id = /^id: (.+)$/m.exec(frame)?.[1];
        if (id) ids.push(id);
        if (name && data) frames.push({ name, data: JSON.parse(data) });
        end = buffer.indexOf("\n\n");
      }
    });
  });
  const transcript = () => frames.filter((frame) => frame.name !== "status");
  /** Resolves once `count` frames other than status have arrived. */
  const received = async (count: number) => {
    for (let waited = 0; transcript().length < count; waited += 5) {
      if (waited > 5000) throw new Error(`only ${transcript().length} of ${count} frames`);
      await tick();
    }
  };
  return { frames, ids, received, close: () => request.destroy() };
}

it("streams a reply as appends to the entry this connection already has", async () => {
  const { session, delta } = await start();
  const stream = listen();
  await stream.received(1);
  delta("m1", "Hello");
  await stream.received(2);
  delta("m1", ", wor");
  await stream.received(3);
  delta("m1", "ld");
  await stream.received(4);
  session.emit({
    id: "final",
    type: "assistant.message",
    timestamp: "2026-10-17T12:00:01Z",
    data: { messageId: "m1", content: "Hello, world" },
  });
  await stream.received(5);
  // A second page joining mid-stream gets the text so far in its snapshot, then appends.
  delta("m2", "Next");
  await stream.received(6);
  const late = listen();
  await late.received(1);
  delta("m2", " one");
  await stream.received(7);
  await late.received(2);
  stream.close();
  late.close();

  const transcript = stream.frames.filter((frame) => frame.name !== "status");
  expect(transcript.map((frame) => frame.name)).toEqual([
    "snapshot",
    "entry",
    "append",
    "append",
    "entry",
    "entry",
    "append",
  ]);
  expect(transcript[2]!.data).toMatchObject({ target: "entry", id: "assistant:m1", text: ", wor" });
  expect(transcript[4]!.data.entry).toMatchObject({ text: "Hello, world", streaming: false });
  const lateNames = late.frames.filter((frame) => frame.name !== "status");
  expect(lateNames.map((frame) => frame.name)).toEqual(["snapshot", "append"]);

  // The client view built from the frames matches the host's own transcript.
  let view = createViewState();
  for (const { name, data } of stream.frames) {
    view = applyServerEvent(view, name as ServerEvent["name"], data);
  }
  expect(view.entries).toEqual(bridge!.getSnapshot().snapshot.entries);
});

it("preserves the full bootstrap transcript and stream snapshot", async () => {
  const history = Array.from({ length: 150 }, (_, index) => ({
    type: index % 2 ? "assistant.message" : "user.message",
    data: { messageId: `m${index}`, content: `turn ${index}` },
  }));
  await start(history);
  const body = await (await fetch(server!.url + API.bootstrap)).json();
  expect(body.snapshot.entries).toHaveLength(150);
  expect(body.snapshot.entries.at(-1).text).toBe("turn 149");
  const stream = listen();
  await stream.received(1);
  stream.close();
  expect(stream.frames[0]!.data.snapshot.entries).toHaveLength(150);
});

it("resumes from Last-Event-ID with only the missed events, and resyncs when it can't", async () => {
  const { session, delta } = await start();
  const first = listen();
  await first.received(1);
  delta("m1", "Hello");
  await first.received(2);
  const lastId = first.ids.at(-1)!;
  expect(lastId).toMatch(/^generation:\d+$/);
  first.close();
  delta("m1", " there");
  delta("m2", "Other");
  await tick();

  const resumed = listen({ "last-event-id": lastId });
  await resumed.received(2);
  delta("m2", " more");
  await resumed.received(3);
  resumed.close();
  const names = resumed.frames.filter((frame) => frame.name !== "status").map((f) => f.name);
  expect(names).not.toContain("snapshot");
  expect(names.slice(0, 2)).toEqual(["entry", "entry"]);
  expect(Number(resumed.ids[0]!.split(":")[1])).toBeGreaterThan(Number(lastId.split(":")[1]));

  for (const stale of ["old-generation:3", "generation:99999", "garbage"]) {
    const resync = listen({ "last-event-id": stale });
    await resync.received(1);
    resync.close();
    expect(resync.frames[0]!.name).toBe("snapshot");
  }
  void session;
});
