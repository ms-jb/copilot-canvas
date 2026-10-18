import { expect, it } from "vite-plus/test";
import type { ActivityItem, TranscriptEntry } from "../src/shared/contract.mts";
import { interleaveActivity, markRuns, type Author } from "../ui/src/components/grouping.ts";
import { buildRows, sameRow, type PendingMessage } from "../ui/src/components/transcriptRows.ts";

const row = (author: Author, timestamp: string) => ({ author, timestamp });

it("shows the author on the first turn of a run and the time on the last", () => {
  const rows = markRuns([
    row("assistant", "2026-10-17T10:00:00"),
    row("assistant", "2026-10-17T10:05:00"),
    row("assistant", "2026-10-17T10:09:00"),
    row("user", "2026-10-17T10:10:00"),
    row("user", "2026-10-17T10:11:00"),
    row("assistant", "2026-10-17T10:12:00"),
  ]);
  expect(rows.map((r) => r.continued)).toEqual([false, true, true, false, true, false]);
  expect(rows.map((r) => r.endsRun)).toEqual([false, false, true, false, true, true]);
});

it("starts a new run on a new day or after an error", () => {
  const rows = markRuns([
    row("assistant", "2026-10-16T23:59:00"),
    row("assistant", "2026-10-17T00:01:00"),
    row("error", "2026-10-17T00:02:00"),
    row("error", "2026-10-17T00:03:00"),
    row("assistant", "2026-10-17T00:04:00"),
  ]);
  expect(rows.map((r) => r.continued)).toEqual([false, false, false, false, false]);
  expect(rows.every((r) => r.endsRun)).toBe(true);
});

it("keeps a turn with an unreadable time in the current run", () => {
  const rows = markRuns([row("assistant", "2026-10-17T10:00:00"), row("assistant", "not a date")]);
  expect(rows.map((r) => r.continued)).toEqual([false, true]);
});

it("interleaves activity between entries by time and groups consecutive steps", () => {
  const entries = [
    { id: "u1", timestamp: "2026-10-17T10:00:00Z" },
    { id: "a1", timestamp: "2026-10-17T10:00:05Z" },
    { id: "a2", timestamp: "2026-10-17T10:00:09Z" },
  ];
  const steps = [
    { id: "r1", timestamp: "2026-10-17T10:00:01Z" },
    { id: "t1", timestamp: "2026-10-17T10:00:05Z" },
    { id: "t2", timestamp: "2026-10-17T10:00:06Z" },
    { id: "t3", timestamp: "2026-10-17T10:00:10Z" },
  ];
  const shape = interleaveActivity(entries, steps).map((item) =>
    item.kind === "entry" ? item.entry.id : item.items.map((step) => step.id).join("+"),
  );
  expect(shape).toEqual(["u1", "r1", "a1", "t1+t2", "a2", "t3"]);
  expect(interleaveActivity(entries, [])).toHaveLength(3);
});

it("builds transcript rows with runs, steps, pending sends and day separators", () => {
  const entries: TranscriptEntry[] = [
    { id: "user:1", kind: "user", text: "hi", timestamp: "2026-10-16T12:00:00" },
    { id: "assistant:1", kind: "assistant", text: "a", timestamp: "2026-10-17T12:00:05" },
    { id: "assistant:2", kind: "assistant", text: "b", timestamp: "2026-10-17T12:00:09" },
  ];
  const thought: ActivityItem = {
    id: "reasoning:1",
    kind: "reasoning",
    text: "hmm",
    timestamp: "2026-10-17T12:00:01",
  };
  const pending: PendingMessage = {
    requestId: "r1",
    text: "more",
    state: "sending",
    createdAt: "2026-10-17T12:01:00",
  };
  const rows = buildRows(entries, [pending], [thought], false);
  expect(rows.map((row) => [row.key, row.separator])).toEqual([
    ["user:1", "2026-10-16T12:00:00"],
    ["activity:reasoning:1", "2026-10-17T12:00:01"],
    ["assistant:1", null],
    ["assistant:2", null],
    ["pending:r1", null],
  ]);
  expect(rows.map((row) => ("continued" in row ? row.continued : null))).toEqual([
    false,
    null,
    false,
    true,
    false,
  ]);
});

it("re-renders only the row a streamed update changed", () => {
  const entries: TranscriptEntry[] = [
    { id: "user:1", kind: "user", text: "hi", timestamp: "2026-10-17T12:00:00" },
    { id: "assistant:1", kind: "assistant", text: "Hel", timestamp: "2026-10-17T12:00:05" },
  ];
  const before = buildRows(entries, [], [], false);
  const streamed = [entries[0]!, { ...entries[1]!, text: "Hello" }];
  const after = buildRows(streamed, [], [], false);
  expect(after.map((row, index) => sameRow(before[index]!, row))).toEqual([true, false]);
  // A new reply ends the previous run, so that row changes too (its time moves down).
  const next = buildRows(
    [
      ...streamed,
      { id: "assistant:2", kind: "assistant", text: "!", timestamp: "2026-10-17T12:01:00" },
    ],
    [],
    [],
    false,
  );
  expect(next.slice(0, 2).map((row, index) => sameRow(after[index]!, row))).toEqual([true, false]);
});
