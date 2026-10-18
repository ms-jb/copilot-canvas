import { expect, it } from "vite-plus/test";
import { describeActivity } from "../../ui/src/components/ActivityBar";
import { formatDuration, visibleActivity } from "../../ui/src/components/activity";
import type { ActivityItem } from "../../src/shared/contract.mts";

it("names the running tool or the latest intent instead of a bare Responding", () => {
  const working = { phase: "working" as const };
  expect(
    describeActivity({ ...working, activity: "tool", toolName: "bash", intent: "Fixing CI" }),
  ).toEqual({ tone: "working", title: "Running bash…", detail: "Fixing CI" });
  expect(describeActivity({ ...working, activity: "responding", intent: "Fixing CI" })?.title).toBe(
    "Fixing CI",
  );
  expect(describeActivity({ ...working, activity: "responding" })?.title).toBe("Writing…");
  expect(describeActivity({ phase: "idle", intent: "stale" })).toBeNull();
});

it("shows tool calls only while the turn runs and formats durations", () => {
  const items: ActivityItem[] = [
    { id: "reasoning:r", kind: "reasoning", text: "hm", timestamp: "1" },
    { id: "tool:t", kind: "tool", name: "bash", state: "succeeded", timestamp: "2" },
  ];
  expect(visibleActivity(items, true)).toHaveLength(2);
  expect(visibleActivity(items, false).map((item) => item.id)).toEqual(["reasoning:r"]);
  expect([182, 2410, 65_000].map(formatDuration)).toEqual(["182 ms", "2.4 s", "1m 05s"]);
});
