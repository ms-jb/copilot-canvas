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
