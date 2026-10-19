import { expect, it } from "vite-plus/test";
import {
  isWithinActiveHours,
  normalizeActiveHours,
  validatePushSettingsPayload,
} from "../../src/shared/contract.mts";

const weekdays = { on: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", zone: "UTC" };

it("sends only inside the window, in the device's own zone, and always when switched off", () => {
  // 2026-10-19 is a Monday.
  expect(isWithinActiveHours(weekdays, new Date("2026-10-19T09:00:00Z"))).toBe(true);
  expect(isWithinActiveHours(weekdays, new Date("2026-10-19T17:00:00Z"))).toBe(false);
  expect(isWithinActiveHours(weekdays, new Date("2026-10-18T09:00:00Z"))).toBe(false);
  expect(
    isWithinActiveHours({ ...weekdays, zone: "Asia/Tokyo" }, new Date("2026-10-19T09:00:00Z")),
  ).toBe(false);
  expect(isWithinActiveHours({ ...weekdays, on: false }, new Date("2026-10-18T03:00:00Z"))).toBe(
    true,
  );
  expect(isWithinActiveHours(undefined)).toBe(true);
});

it("treats an end before the start as a window that crosses midnight", () => {
  const night = { ...weekdays, days: [5], start: "22:00", end: "06:00" };
  expect(isWithinActiveHours(night, new Date("2026-10-23T23:00:00Z"))).toBe(true);
  // Saturday 05:00 still belongs to Friday's window.
  expect(isWithinActiveHours(night, new Date("2026-10-24T05:00:00Z"))).toBe(true);
  expect(isWithinActiveHours(night, new Date("2026-10-24T07:00:00Z"))).toBe(false);
});

it("accepts only complete, valid settings", () => {
  expect(normalizeActiveHours({ ...weekdays, days: [3, 1, 1] })?.days).toEqual([1, 3]);
  for (const bad of [
    { ...weekdays, start: "8:00" },
    { ...weekdays, end: weekdays.start },
    { ...weekdays, zone: "Not/AZone" },
    { ...weekdays, days: [] },
    { ...weekdays, days: [7] },
    { ...weekdays, extra: true },
  ]) {
    expect(normalizeActiveHours(bad)).toBeNull();
  }
  expect(
    validatePushSettingsPayload({ endpoint: "https://x.test/a", activeHours: weekdays }).ok,
  ).toBe(true);
  expect(validatePushSettingsPayload({ endpoint: "", activeHours: weekdays }).ok).toBe(false);
});
