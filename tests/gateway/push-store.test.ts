import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { openPushStore } from "../../gateway/push.mts";
import { APPLE, FCM, usePushDirectory } from "./fixtures.mts";

const directory = usePushDirectory();

it("keeps keys across restarts and drops subscriptions the push service reports gone", async () => {
  const path = join(directory(), "push.json");
  const first = openPushStore(path, async () => 410);
  first.add(APPLE);
  first.add(FCM);
  const again = openPushStore(path, async (endpoint) => (endpoint === APPLE ? 410 : 201));
  expect(again.publicKey).toBe(first.publicKey);
  expect(await again.sendAll()).toBe(1);
  expect(again.endpoints()).toEqual([FCM]);
});

it("skips the subscriptions a filter excludes", async () => {
  const sent: string[] = [];
  const store = openPushStore(join(directory(), "push.json"), async (endpoint) => {
    sent.push(endpoint);
    return 201;
  });
  store.add(APPLE);
  store.add(FCM);
  expect(await store.sendAll((endpoint) => endpoint === APPLE)).toBe(1);
  expect(sent).toEqual([FCM]);
});

it("applies per-device active hours unless a send bypasses them", async () => {
  const sent: string[] = [];
  const store = openPushStore(join(directory(), "push.json"), async (endpoint) => {
    sent.push(endpoint);
    return 201;
  });
  store.add(APPLE, {
    activeHours: {
      on: true,
      days: [1, 2, 3, 4, 5],
      start: "08:00",
      end: "17:00",
      zone: "UTC",
    },
  });
  store.add(FCM);
  expect(
    store.setActiveHours("https://example.com/push", {
      on: true,
      days: [1],
      start: "09:00",
      end: "10:00",
      zone: "UTC",
    }),
  ).toBe(false);
  expect(
    await store.sendAll({
      nowMs: Date.parse("2026-10-18T03:00:00.000Z"),
    }),
  ).toBe(1);
  expect(sent).toEqual([FCM]);
  sent.length = 0;
  expect(
    await store.sendAll({
      nowMs: Date.parse("2026-10-18T03:00:00.000Z"),
      ignoreActiveHours: true,
    }),
  ).toBe(2);
});
