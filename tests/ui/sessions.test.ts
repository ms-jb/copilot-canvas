import { expect, it } from "vite-plus/test";
import {
  nativeSessionPanel,
  relativeSessionTime,
  sessionLink,
  stateLabels,
} from "../../ui/src/features/sessions/model";
import type { SessionSummary } from "../../src/shared/contract.mts";

const row: SessionSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Session",
  project: null,
  state: "busy",
  updatedAt: null,
  current: false,
  canOpen: true,
};

it("only links exact app UUIDs from the native embedded panel", () => {
  expect(sessionLink(row, true)).toBe(`ghapp://sessions/${row.id}`);
  expect(sessionLink(row, false)).toBeUndefined();
  expect(sessionLink({ ...row, canOpen: false }, true)).toBeUndefined();
  expect(sessionLink({ ...row, id: "javascript:alert(1)" }, true)).toBeUndefined();
  expect(nativeSessionPanel("localhost", true, false)).toBe(true);
  expect(nativeSessionPanel("localhost", true, true)).toBe(false);
  expect(nativeSessionPanel("localhost", false, false)).toBe(false);
  expect(nativeSessionPanel("phone.example", true, false)).toBe(false);
});

it("maps unknown states honestly and handles relative, future and missing times", () => {
  const now = Date.parse("2026-10-17T20:00:00Z");
  expect(stateLabels.unknown).toBe("Activity unknown");
  expect(stateLabels.waiting).toBe("Needs you");
  expect(relativeSessionTime(null, now)).toBe("Time unknown");
  expect(relativeSessionTime("bad", now)).toBe("Time unknown");
  expect(relativeSessionTime("2026-10-17T20:01:00Z", now)).toBe("Just now");
  expect(relativeSessionTime("2026-10-17T19:58:00Z", now)).toBe("2m ago");
  expect(relativeSessionTime("2026-10-17T18:00:00Z", now)).toBe("2h ago");
  expect(relativeSessionTime("2026-10-15T20:00:00Z", now)).toBe("2d ago");
});
