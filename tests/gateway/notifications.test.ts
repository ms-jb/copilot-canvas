import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import type { PendingPrompt, SessionStatus, TranscriptEntry } from "../../src/shared/contract.mts";
import {
  classifyAttention,
  createNotifier,
  createPresence,
  LONG_TURN_MS,
  openPushStore,
  parseSse,
} from "../../gateway/push.mts";
import { deliverNotice } from "../../gateway/server/push-watcher.mts";
import type { Notice } from "../../gateway/push.mts";
import { APPLE, FCM, usePushDirectory } from "./fixtures.mts";

const directory = usePushDirectory();

it("treats a device as focused until it reports otherwise or its report lapses", () => {
  const presence = createPresence(1000);
  expect(presence.isFocused(APPLE, 0)).toBe(false);
  expect(presence.hasFocused(0)).toBe(false);
  presence.report(APPLE, true, 0);
  expect(presence.isFocused(APPLE, 999)).toBe(true);
  expect(presence.hasFocused(999)).toBe(true);
  expect(presence.isFocused(FCM, 999)).toBe(false);
  expect(presence.isFocused(APPLE, 1000)).toBe(false);
  expect(presence.hasFocused(1000)).toBe(false);
  presence.report(APPLE, true, 2000);
  presence.report(APPLE, false, 2100);
  expect(presence.isFocused(APPLE, 2200)).toBe(false);
  presence.report(APPLE, true, 3000);
  presence.forget(APPLE);
  expect(presence.isFocused(APPLE, 3100)).toBe(false);
});

it("pushes only Attention Events: decisions, blockers, replies and accepted completions", () => {
  const classify = (event: Parameters<typeof classifyAttention>[0]) => {
    const { push, kind } = classifyAttention(event);
    return push ? kind : "silent";
  };
  for (const kind of ["permission", "question", "form", "plan", undefined]) {
    expect(classify({ type: "prompt", kind })).toBe("decision");
  }
  for (const waitingFor of ["permission", "input", "elicitation", "plan", undefined] as const) {
    expect(classify({ type: "waiting", waitingFor })).toBe("decision");
  }
  expect(classify({ type: "session-error" })).toBe("blocker");
  // A turn that ends with a reply is a reply, whatever its length; one that said nothing is a
  // completion only past two minutes, with a known start and no error.
  const turn = (durationMs: number | null, failed = false, replied = false) =>
    classify({ type: "turn-finished", durationMs, failed, replied });
  expect(turn(LONG_TURN_MS + 1)).toBe("completion");
  expect(turn(LONG_TURN_MS)).toBe("silent");
  expect(turn(30_000)).toBe("silent");
  expect(turn(null)).toBe("silent");
  expect(turn(LONG_TURN_MS * 5, true)).toBe("silent");
  expect(turn(1_000, false, true)).toBe("reply");
  expect(turn(null, false, true)).toBe("reply");
  expect(turn(LONG_TURN_MS * 5, false, true)).toBe("reply");
  expect(turn(1_000, true, true)).toBe("silent");
  expect(classify({ type: "reply" })).toBe("reply");
  expect(classify({ type: "status" })).toBe("silent");
});

const waiting = (waitingFor: SessionStatus["waitingFor"]): SessionStatus => ({
  phase: "waiting",
  waitingFor,
});
const idle: SessionStatus = { phase: "idle" };
const working: SessionStatus = { phase: "working", activity: "tool", toolName: "bash" };
const prompt = (requestId: string) => ({ requestId, kind: "permission" }) as PendingPrompt;
const error = (id: string): TranscriptEntry => ({
  id,
  kind: "error",
  text: "Model call failed",
  timestamp: "2026-10-18T05:00:00.000Z",
});

it("notifies once per new request and never again on reconnect", () => {
  const notifier = createNotifier("Atlas");
  expect(notifier.snapshot("gen-1", { status: idle, prompts: [] }, 0)).toBeNull();
  expect(notifier.status(working, 10)).toBeNull();
  expect(notifier.status(waiting("permission"), 20)?.body).toBe("Waiting for your permission.");
  // The matching prompt arrives a moment later: same request, no second buzz.
  expect(notifier.prompts([prompt("r1")], 30)).toBeNull();
  // Reconnecting to the same run repeats nothing.
  expect(
    notifier.snapshot("gen-1", { status: waiting("permission"), prompts: [prompt("r1")] }, 10_000),
  ).toBeNull();
  // A second request of the same kind still notifies.
  expect(notifier.prompts([prompt("r1"), prompt("r2")], 20_000)?.title).toBe("Atlas needs you");
});

it("notifies for a request already waiting when a new provider run is first seen", () => {
  const notifier = createNotifier("Copilot");
  expect(notifier.snapshot("gen-2", { status: waiting("plan") }, 0)?.body).toBe(
    "Has a plan ready for you to review.",
  );
});

it("stays silent for quick turns with no reply, and pushes a reply-less turn over two minutes", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle }, 0);
  // A quick turn: working, a tool call, an intent, idle. No news, no push.
  expect(notifier.status(working, 1_000)).toBeNull();
  expect(notifier.status({ ...working, intent: "Running tests" }, 2_000)).toBeNull();
  expect(notifier.status({ phase: "working", activity: "responding" }, 3_000)).toBeNull();
  expect(notifier.status(idle, 60_000)).toBeNull();
  // A long one, including time spent waiting on the user, is a completion.
  expect(notifier.status(working, 100_000)).toBeNull();
  notifier.status(waiting("permission"), 110_000);
  expect(notifier.status(working, 120_000)).toBeNull();
  expect(notifier.status(idle, 100_000 + 4 * 60_000)).toEqual({
    title: "Atlas finished",
    body: "Done after 4 min. Ready for your next step.",
  });
  // A turn already running when the notifier first saw the run has no known start: silent.
  const late = createNotifier("Atlas");
  late.snapshot("gen-1", { status: working }, 0);
  expect(late.status(idle, 10 * 60_000)).toBeNull();
  // A request cancelled from "waiting" isn't a completion.
  notifier.status(working, 1_000_000);
  notifier.status(waiting("input"), 1_001_000);
  expect(notifier.status(idle, 1_400_000)).toBeNull();
});

it("pushes a session error once as a blocker, and not again as the turn's completion", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle, entries: [error("error:old")] }, 0);
  notifier.status(working, 1_000);
  const blocker = notifier.entry(error("error:e1"));
  expect(blocker).toEqual({
    title: "Atlas is blocked",
    body: "Work stopped on an error. Open the canvas to see it.",
    tag: "blocker",
  });
  expect(notifier.entry(error("error:e1"))).toBeNull();
  // The turn's reply doesn't add a second notice to the blocker.
  expect(notifier.entry({ ...error("assistant:m1"), kind: "assistant" })).toBeNull();
  expect(notifier.status(idle, 10 * 60_000)).toBeNull();
  // An error missed while the stream was down is reported on reconnect; old ones never are.
  const missed = notifier.snapshot(
    "gen-1",
    { status: idle, entries: [error("error:old"), error("error:e1"), error("error:e2")] },
    11 * 60_000,
  );
  expect(missed?.title).toBe("Atlas is blocked");
  expect(notifier.snapshot("gen-2", { status: idle, entries: [error("error:e3")] }, 0)).toBeNull();
});

const reply = (id: string, text: string, streaming = false): TranscriptEntry => ({
  id,
  kind: "assistant",
  text,
  timestamp: "2026-10-18T05:00:00.000Z",
  ...(streaming ? { streaming: true } : {}),
});

it("pushes every short reply once, titled for the assistant and opening the chat", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle, entries: [reply("assistant:old", "Earlier.")] }, 0);
  // A quick turn that ends with a reply is no longer silent.
  expect(notifier.status(working, 1_000)).toBeNull();
  expect(notifier.entry(reply("assistant:m1", "Sure, the timeout is 30 seconds."))).toBeNull();
  expect(notifier.status(idle, 5_000)).toEqual({
    title: "Atlas replied",
    body: "Sure, the timeout is 30 seconds.",
    tag: "reply-assistant_m1",
    url: "/#/chat",
  });
  // Reconnecting, or the same entry again, never repeats it; nor does history on a new run.
  const entries = [reply("assistant:old", "Earlier."), reply("assistant:m1", "Sure.")];
  expect(notifier.snapshot("gen-1", { status: idle, entries }, 6_000)).toBeNull();
  expect(notifier.entry(reply("assistant:m1", "Sure."))).toBeNull();
  expect(notifier.snapshot("gen-2", { status: idle, entries }, 7_000)).toBeNull();
  // The next turn's reply is a new notice with its own tag.
  notifier.status(working, 8_000);
  notifier.entry(reply("assistant:m2", "Done."));
  expect(notifier.status(idle, 9_000)).toMatchObject({ body: "Done.", tag: "reply-assistant_m2" });
});

it("makes a long turn that ends with a reply one notice, not a reply and a completion", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle }, 0);
  notifier.status(working, 1_000);
  notifier.entry(reply("assistant:m1", "Done. I updated the timeout and added a test."));
  const done = notifier.status(idle, LONG_TURN_MS + 2_000);
  expect(done).toMatchObject({ title: "Atlas replied", tag: "reply-assistant_m1" });
  expect(notifier.status(idle, LONG_TURN_MS + 3_000)).toBeNull();
  // A turn with no reply keeps the "finished" notice.
  notifier.status(working, 200_000);
  expect(notifier.status(idle, 200_000 + LONG_TURN_MS + 1)?.title).toBe("Atlas finished");
});

it("uses the settled text of a streamed reply and notices only the turn's last reply", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle }, 0);
  // The stream's entry event precedes the status change, then the settled text replaces it.
  notifier.entry(reply("assistant:m1", "I'll", true));
  notifier.status({ phase: "working", activity: "responding" }, 1_000);
  notifier.entry(reply("assistant:m1", "I'll check the logs first."));
  notifier.entry(reply("assistant:m2", "The logs show a timeout.", true));
  notifier.entry(reply("assistant:m2", "The logs show a timeout in the worker."));
  expect(notifier.status(idle, 9_000)).toMatchObject({
    body: "The logs show a timeout in the worker.",
    tag: "reply-assistant_m2",
  });
  // Replies of earlier turns that were not pushed are not announced when the stream reconnects.
  const entries = [reply("assistant:m1", "I'll check the logs first.")];
  expect(notifier.snapshot("gen-1", { status: idle, entries }, 10_000)).toBeNull();
});

it("notices a reply that arrives between turns or while the stream was down, once", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle }, 0);
  expect(notifier.entry(reply("assistant:late", "A late message."))).toMatchObject({
    title: "Atlas replied",
    tag: "reply-assistant_late",
  });
  expect(notifier.entry(reply("assistant:late", "A late message."))).toBeNull();
  // A whole turn that happened while the stream was down is reported on reconnect.
  const missed = notifier.snapshot(
    "gen-1",
    {
      status: idle,
      entries: [reply("assistant:late", "x"), reply("assistant:gone", "Missed it.")],
    },
    5_000,
  );
  expect(missed?.body).toBe("Missed it.");
  // A turn that errored is announced as a blocker only.
  notifier.status(working, 6_000);
  notifier.entry(error("error:e9"));
  notifier.entry(reply("assistant:m9", "Sorry about that."));
  expect(notifier.status(idle, 7_000)).toBeNull();
});

it("trims long replies to one short preview", () => {
  const notifier = createNotifier("Atlas");
  notifier.snapshot("gen-1", { status: idle }, 0);
  notifier.status(working, 1_000);
  notifier.entry(reply("assistant:m1", `${"Word ".repeat(80)}end`));
  const { body } = notifier.status(idle, 2_000) ?? { body: "" };
  expect(body.length).toBeLessThanOrEqual(170);
  expect(body.startsWith("Word Word")).toBe(true);
});

it("holds a reply push while any device has the app focused, and sends it otherwise", async () => {
  const sent: string[] = [];
  const store = openPushStore(join(directory(), "push.json"), async (endpoint) => {
    sent.push(endpoint);
    return 201;
  });
  store.add(APPLE);
  store.add(FCM);
  const presence = createPresence(1000);
  const push = { store, presence, latest: null as Notice | null };
  const notice: Notice = {
    title: "Atlas replied",
    body: "Done.",
    tag: "reply-assistant_m1",
    url: "/#/chat",
  };
  // Focused on one device: held for every device, and the shown notice is not replaced.
  presence.report(APPLE, true);
  expect(await deliverNotice(push, notice)).toBe(0);
  expect(sent).toEqual([]);
  expect(push.latest).toBeNull();
  // The report lapsing or the app going to the background sends it to every device.
  presence.report(APPLE, false);
  expect(await deliverNotice(push, notice)).toBe(2);
  expect(sent.sort()).toEqual([APPLE, FCM].sort());
  expect(push.latest).toEqual(notice);
  expect(await deliverNotice(push, null)).toBe(0);
});

it("respects a device's notification hours for a reply but not for a blocker", async () => {
  const sent: string[] = [];
  const store = openPushStore(join(directory(), "push.json"), async (endpoint) => {
    sent.push(endpoint);
    return 201;
  });
  // A window of one minute on a day that is never today's: always outside.
  const day = (new Date().getUTCDay() + 3) % 7;
  store.add(APPLE, {
    activeHours: { on: true, days: [day], start: "08:00", end: "09:00", zone: "UTC" },
  });
  const push = { store, presence: createPresence(1000), latest: null as Notice | null };
  expect(await deliverNotice(push, { title: "Atlas replied", body: "Done." })).toBe(0);
  expect(await deliverNotice(push, { title: "Atlas is blocked", body: "x", tag: "blocker" })).toBe(
    1,
  );
});

it("parses complete SSE frames and keeps the remainder", () => {
  const { frames, rest } = parseSse(': keepalive\n\nevent: status\ndata: {"a":1}\n\nevent: pro');
  expect(frames).toEqual([{ event: "status", data: '{"a":1}' }]);
  expect(rest).toBe("event: pro");
});
