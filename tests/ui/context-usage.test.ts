import { expect, it } from "vite-plus/test";
import {
  describeCompaction,
  describeUsage,
  formatTokens,
  usageBreakdown,
  usagePercent,
  usageTone,
} from "../../ui/src/features/context/usage";

const usage = (currentTokens: number, extra = {}) => ({
  currentTokens,
  tokenLimit: 200000,
  ...extra,
});

it("rounds the share down and clamps it", () => {
  expect(usagePercent(usage(199900))).toBe(99);
  expect(usagePercent(usage(250000))).toBe(100);
  expect(usagePercent(usage(0))).toBe(0);
});

it("warns from 70% and alarms from 85%, or earlier near the auto-compaction point", () => {
  expect(usageTone(usage(139000))).toBe("ok");
  expect(usageTone(usage(140000))).toBe("warn");
  expect(usageTone(usage(170000))).toBe("danger");
  const auto = { compactionThreshold: 100000 };
  expect(usageTone(usage(89000, auto))).toBe("ok");
  expect(usageTone(usage(90000, auto))).toBe("warn");
  expect(usageTone(usage(100000, auto))).toBe("danger");
});

it("formats token counts compactly", () => {
  expect([950, 1000, 12345, 99950, 128000, 200000, 1_000_000, 1_250_000].map(formatTokens)).toEqual(
    ["950", "1k", "12.3k", "100k", "128k", "200k", "1M", "1.3M"],
  );
});

it("itemizes what fills the window, largest first, with the unitemized rest as Other", () => {
  expect(usageBreakdown(usage(5000))).toEqual([]);
  const parts = usageBreakdown(
    usage(50000, { systemTokens: 10000, conversationTokens: 30000, toolDefinitionsTokens: 0 }),
  );
  expect(parts.map((part) => [part.key, part.tokens, part.percent])).toEqual([
    ["conversation", 30000, 15],
    ["system", 10000, 5],
    ["other", 10000, 5],
  ]);
});

it("describes usage and compaction outcomes in plain words", () => {
  expect(describeUsage(null)).toContain("after the first reply");
  expect(describeUsage(usage(90000))).toBe("Context 45% full: 90k of 200k tokens");
  expect(
    describeCompaction({ success: true, tokensRemoved: 40000, messagesRemoved: 1, at: "" }),
  ).toBe("Compacted, freeing 40k tokens and 1 message.");
  expect(describeCompaction({ success: true, at: "" })).toBe("Compacted.");
  expect(describeCompaction({ success: false, at: "" })).toContain("didn't finish");
});
