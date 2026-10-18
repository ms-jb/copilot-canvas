import { expect, it, vi } from "vite-plus/test";
import {
  createContextTracker,
  usageFromContextInfo,
  usageFromEvent,
} from "../../src/host/session/context.mts";
import { validateContextState, validateContextUsage } from "../../src/shared/contract.mts";
import { deferred } from "./fixtures";

const event = (type: string, data: Record<string, unknown> = {}, agentId?: string) => ({
  type,
  data,
  agentId,
  timestamp: "2026-10-18T12:00:00Z",
});

it("parses only finite measured usage and validates the read-only contract", () => {
  for (const value of [
    null,
    {},
    { currentTokens: 1, tokenLimit: 0 },
    { currentTokens: -1, tokenLimit: 10 },
    { currentTokens: Infinity, tokenLimit: 10 },
  ]) {
    expect(usageFromEvent(value)).toBeNull();
    expect(validateContextUsage(value)).toBe(false);
  }
  expect(
    usageFromContextInfo({
      contextInfo: { totalTokens: 20, promptTokenLimit: 100, systemTokens: 5 },
    }),
  ).toEqual({ currentTokens: 20, tokenLimit: 100, systemTokens: 5 });
  expect(usageFromContextInfo({ contextInfo: { totalTokens: 1, promptTokenLimit: 0 } })).toBeNull();
  expect(
    validateContextState({ usage: null, compacting: false, actions: { refresh: false } }),
  ).toBe(true);
  expect(validateContextState({ usage: null, compacting: "no", actions: { refresh: true } })).toBe(
    false,
  );
});

it("keeps the compaction threshold until a model changes and ignores child usage", async () => {
  const tracker = createContextTracker(
    {
      metadata: {
        contextInfo: async () => ({
          contextInfo: { totalTokens: 10, promptTokenLimit: 100, compactionThreshold: 80 },
        }),
      },
    },
    vi.fn(),
  );
  expect(await tracker.refresh()).toBe("refreshed");
  tracker.applyEvent(event("session.usage_info", { currentTokens: 20, tokenLimit: 100 }));
  expect(tracker.snapshot().usage).toMatchObject({ currentTokens: 20, compactionThreshold: 80 });
  tracker.applyEvent(event("session.usage_info", { currentTokens: 1, tokenLimit: 2 }, "child"));
  expect(tracker.snapshot().usage?.currentTokens).toBe(20);
  tracker.applyEvent(event("session.usage_info", { currentTokens: 25, tokenLimit: 200 }));
  expect(tracker.snapshot().usage?.compactionThreshold).toBeUndefined();
  tracker.dispose();
});

it("observes automatic compaction but offers no mutation", () => {
  const tracker = createContextTracker(undefined, vi.fn());
  expect(tracker).not.toHaveProperty("compact");
  tracker.applyEvent(event("session.usage_info", { currentTokens: 90, tokenLimit: 100 }));
  tracker.applyEvent(event("session.compaction_start"));
  expect(tracker.snapshot().compacting).toBe(true);
  tracker.applyEvent(
    event("session.compaction_complete", {
      success: true,
      postCompactionTokens: 30,
      tokensRemoved: 60,
      messagesRemoved: 4,
    }),
  );
  expect(tracker.snapshot()).toMatchObject({
    compacting: false,
    usage: { currentTokens: 30, tokenLimit: 100 },
    lastCompaction: { success: true, tokensRemoved: 60, messagesRemoved: 4 },
  });
  tracker.dispose();
});

it("does not let a slow metadata read overwrite newer event usage", async () => {
  const pending = deferred<unknown>();
  const contextInfo = vi.fn(() => pending.promise);
  const tracker = createContextTracker({ metadata: { contextInfo } }, vi.fn());
  const first = tracker.refresh();
  expect(tracker.refresh()).toBe(first);
  tracker.applyEvent(event("session.usage_info", { currentTokens: 80, tokenLimit: 100 }));
  pending.resolve({ contextInfo: { totalTokens: 10, promptTokenLimit: 100 } });
  await first;
  expect(contextInfo).toHaveBeenCalledTimes(1);
  expect(tracker.snapshot().usage?.currentTokens).toBe(80);
  tracker.dispose();
});

it("reports unavailable, failed, malformed and timed-out reads without inventing usage", async () => {
  const absent = createContextTracker(undefined, vi.fn());
  expect(await absent.refresh()).toBe("unavailable");
  absent.dispose();
  for (const contextInfo of [
    async () => ({}),
    async () => {
      throw new Error("private backend error");
    },
    () => new Promise<unknown>(() => {}),
  ]) {
    const tracker = createContextTracker({ metadata: { contextInfo } }, vi.fn(), {
      readTimeoutMs: 5,
    });
    expect(await tracker.refresh()).toBe("failed");
    expect(tracker.snapshot().usage).toBeNull();
    tracker.dispose();
  }
});

it("disposal prevents a late read from publishing", async () => {
  const pending = deferred<unknown>();
  const notify = vi.fn();
  const tracker = createContextTracker(
    { metadata: { contextInfo: () => pending.promise } },
    notify,
  );
  const reading = tracker.refresh();
  tracker.dispose();
  pending.resolve({ contextInfo: { totalTokens: 10, promptTokenLimit: 100 } });
  await reading;
  expect(notify).not.toHaveBeenCalled();
});
