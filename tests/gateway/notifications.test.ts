import { expect, it } from "vite-plus/test";
import type { PendingPrompt, SessionStatus } from "../../src/shared/contract.mts";
import { createNotifier, createPresence, parseSse } from "../../gateway/push.mts";
import { APPLE, FCM } from "./fixtures.mts";

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
