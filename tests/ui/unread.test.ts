import { describe, expect, it } from "vite-plus/test";
import { buildRows } from "../../ui/src/components/transcriptRows";
import { hashFromWorker } from "../../ui/src/features/unread/appBadge";
import {
  countUnread,
  dividerFor,
  dividerLabel,
  EMPTY_MARKER,
  markerAfter,
  parseMarker,
  sameMarker,
} from "../../ui/src/features/unread/model";
import type { TranscriptEntry } from "../../src/shared/contract.mts";

let tick = 0;
const entry = (id: string, kind: TranscriptEntry["kind"] = "assistant"): TranscriptEntry => {
  tick += 1;
  return {
    id,
    kind,
    text: id,
    timestamp: new Date(Date.UTC(2026, 9, 19, 12, 0, tick)).toISOString(),
  } as TranscriptEntry;
};

describe("chat unread", () => {
  const history = [entry("user:1", "user"), entry("a:1"), entry("user:2", "user"), entry("a:2")];

  it("counts assistant replies after the read marker, and where the first one is", () => {
    expect(countUnread(history, markerAfter(history.slice(0, 2), null))).toEqual({
      count: 1,
      firstId: "a:2",
    });
    const more = [...history, entry("a:3"), entry("error:1", "error"), entry("a:4")];
    expect(countUnread(more, markerAfter(history, null))).toEqual({ count: 2, firstId: "a:3" });
    expect(countUnread(more, markerAfter(more, null)).count).toBe(0);
  });

  it("counts nothing before a device has a marker, and the first transcript is read", () => {
    expect(countUnread(history, null)).toEqual({ count: 0, firstId: null });
    expect(markerAfter(history, null)).toEqual({ id: "a:2", at: history[3]!.timestamp });
  });

  it("counts nothing again when the same transcript is replayed", () => {
    const marker = markerAfter(history, null);
    expect(countUnread([...history], marker).count).toBe(0);
    // A reconnect snapshot can also start later in the history.
    expect(countUnread(history.slice(1), marker).count).toBe(0);
    expect(parseMarker(JSON.stringify(marker))).toEqual(marker);
  });

  it("falls back to time when the marker's entry is gone: old replayed history is not new", () => {
    const marker = markerAfter(history, null);
    const replayedElsewhere = history.map((old) => ({ ...old, id: `new-${old.id}` }));
    expect(countUnread(replayedElsewhere, marker).count).toBe(0);
    const fresh = [...replayedElsewhere, entry("new-a:3")];
    expect(countUnread(fresh, marker)).toEqual({ count: 1, firstId: "new-a:3" });
  });

  it("counts every reply after an empty transcript was read", () => {
    const marker = markerAfter([], null);
    expect(marker).toEqual(EMPTY_MARKER);
    expect(countUnread([entry("b:1"), entry("b:2")], marker).count).toBe(2);
    expect(markerAfter([], marker)).toBe(marker);
  });

  it("reads a stored marker defensively", () => {
    for (const junk of [
      "",
      "null",
      "[]",
      '{"id":1,"at":"x"}',
      '{"id":"a","at":"not a date"}',
      "{",
    ]) {
      expect(parseMarker(junk)).toBeUndefined();
    }
    expect(
      sameMarker({ id: "a", at: "2026-10-19T00:00:00Z" }, { id: "a", at: "2026-10-19T00:00:00Z" }),
    ).toBe(true);
    expect(sameMarker(null, EMPTY_MARKER)).toBe(false);
  });

  it("labels the divider and puts it above the first unread entry only", () => {
    const unread = countUnread(
      [...history, entry("a:3"), entry("a:4")],
      markerAfter(history, null),
    );
    const divider = dividerFor(unread)!;
    expect(dividerLabel(divider)).toBe("2 new");
    expect(dividerLabel({ entryId: "x", count: 1 })).toBe("New");
    expect(dividerFor({ count: 0, firstId: null })).toBeNull();
    const rows = buildRows([...history, entry("a:3"), entry("a:4")], [], [], false, {
      entryId: divider.entryId,
      label: dividerLabel(divider),
    });
    expect(rows.filter((row) => row.unread).map((row) => [row.key, row.unread])).toEqual([
      ["a:3", "2 new"],
    ]);
    expect(buildRows(history, [], [], false).every((row) => row.unread === null)).toBe(true);
  });
});

describe("app badge", () => {
  it("follows a worker's open message only into this page", () => {
    const page = new URL("https://phone.test/");
    expect(hashFromWorker({ type: "open", url: "https://phone.test/#/chat" }, page)).toBe("#/chat");
    expect(hashFromWorker({ type: "open", url: "/" }, page)).toBe("#/");
    expect(hashFromWorker({ type: "open", url: "https://evil.test/#/chat" }, page)).toBeNull();
    expect(
      hashFromWorker({ type: "open", url: "https://phone.test/other#/chat" }, page),
    ).toBeNull();
    expect(hashFromWorker({ type: "badge", count: 2 }, page)).toBeNull();
    expect(hashFromWorker(null, page)).toBeNull();
  });
});
