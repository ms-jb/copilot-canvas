import { expect, it } from "vite-plus/test";
import { markContinuations, type Author } from "../ui/src/components/grouping.ts";

const row = (author: Author, timestamp: string) => ({ author, timestamp });

it("shows the author once per run of turns", () => {
  const rows = markContinuations([
    row("assistant", "2026-10-17T10:00:00"),
    row("assistant", "2026-10-17T10:05:00"),
    row("assistant", "2026-10-17T10:09:00"),
    row("user", "2026-10-17T10:10:00"),
    row("user", "2026-10-17T10:11:00"),
    row("assistant", "2026-10-17T10:12:00"),
  ]);
  expect(rows.map((r) => r.continued)).toEqual([false, true, true, false, true, false]);
});

it("starts a new run on a new day or after an error", () => {
  const rows = markContinuations([
    row("assistant", "2026-10-16T23:59:00"),
    row("assistant", "2026-10-17T00:01:00"),
    row("error", "2026-10-17T00:02:00"),
    row("error", "2026-10-17T00:03:00"),
    row("assistant", "2026-10-17T00:04:00"),
  ]);
  expect(rows.map((r) => r.continued)).toEqual([false, false, false, false, false]);
});

it("keeps a turn with an unreadable time in the current run", () => {
  const rows = markContinuations([
    row("assistant", "2026-10-17T10:00:00"),
    row("assistant", "not a date"),
  ]);
  expect(rows.map((r) => r.continued)).toEqual([false, true]);
});
