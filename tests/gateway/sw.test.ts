import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

const ORIGIN = "https://phone.test";
const SOURCE = readFileSync(new URL("../../gateway/sw.js", import.meta.url), "utf8");
const PAGE = `<!doctype html><script type="module" src="./assets/index-AAAAaaaa.js"></script>
<link rel="modulepreload" href="./assets/api-BBBBbbbb.js"><link rel="stylesheet" href="./assets/index-CCCCcccc.css">
<link rel="manifest" href="./assets/manifest.webmanifest"><link rel="icon" href="./assets/icon.svg">`;

type Handler = (event: any) => void;
type FakeRequest = { url: string; method: string; mode: string; headers: Headers };

/** Loads gateway/sw.js against in-memory caches (shared to restart a worker) and a scripted network. */
function worker(
  network: (url: string, init?: RequestInit) => Response | Promise<Response>,
  stores = new Map<string, Map<string, Response>>(),
  device: { windows?: object[]; badging?: boolean } = {},
) {
  const handlers = new Map<string, Handler>();
  const fetched: string[] = [];
  const shown: object[] = [];
  const badges: (number | "clear")[] = [];
  const opened: string[] = [];
  const href = (key: string | FakeRequest) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).href;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (key: string | FakeRequest) => store.get(href(key))?.clone(),
      put: async (key: string | FakeRequest, response: Response) => {
        store.set(href(key), response);
      },
      keys: async () => [...store.keys()],
      delete: async (key: string) => store.delete(href(key)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string, { cacheName }: { cacheName: string }) =>
      stores.get(cacheName)?.get(href(key))?.clone(),
  };
  const fetch = async (input: string | FakeRequest, init?: RequestInit) => {
    const url = href(input);
    fetched.push(new URL(url).pathname);
    const response = await network(url, init);
    // Same-origin answers from a real network are "basic"; a constructed Response says "default".
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => device.windows ?? [],
      openWindow: async (url: string) => opened.push(url),
    },
    navigator:
      device.badging === false
        ? {}
        : {
            setAppBadge: async (count: number) => badges.push(count),
            clearAppBadge: async () => badges.push("clear"),
          },
    registration: {
      showNotification: async (title: string, options: object) => shown.push({ title, ...options }),
    },
  };
  runInNewContext(SOURCE, {
    self,
    caches,
    fetch,
    URL,
    Response,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
  });

  async function dispatch(name: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(name)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      respondWith: (promise: Promise<Response>) => (response = promise),
    });
    const result = await response;
    await Promise.all(waits);
    return result;
  }
  const request = (path: string, init: Partial<FakeRequest> = {}): FakeRequest => ({
    url: new URL(path, ORIGIN).href,
    method: "GET",
    mode: "cors",
    headers: new Headers(),
    ...init,
  });
  return { dispatch, request, stores, fetched, shown, badges, opened };
}

const ok = (body: string) => new Response(body, { status: 200 });

it("precaches the page and everything it links, and drops caches of older versions", async () => {
  const sw = worker((url) => ok(url.endsWith("/") ? PAGE : `body of ${url}`));
  sw.stores.set("cc-assets-v0", new Map());
  sw.stores.set("someone-else", new Map());
  await sw.dispatch("install");
  await sw.dispatch("activate");
  expect([...sw.stores.keys()].sort()).toEqual(["cc-assets-v1", "cc-shell-v1", "someone-else"]);
  expect([...sw.stores.get("cc-assets-v1")!.keys()].map((url) => new URL(url).pathname)).toEqual([
    "/assets/index-AAAAaaaa.js",
    "/assets/api-BBBBbbbb.js",
    "/assets/index-CCCCcccc.css",
  ]);
  expect([...sw.stores.get("cc-shell-v1")!.keys()].map((url) => new URL(url).pathname)).toEqual([
    "/",
    "/assets/manifest.webmanifest",
    "/assets/icon.svg",
  ]);
});

it("serves hashed chunks from the cache and never touches API calls, ranges or writes", async () => {
  const sw = worker((url) => ok(`body of ${new URL(url).pathname}`));
  const chunk = sw.request("/assets/index-maKIB4TF.js");
  expect(await (await sw.dispatch("fetch", { request: chunk }))!.text()).toBe(
    "body of /assets/index-maKIB4TF.js",
  );
  expect(await (await sw.dispatch("fetch", { request: chunk }))!.text()).toBe(
    "body of /assets/index-maKIB4TF.js",
  );
  expect(sw.fetched).toEqual(["/assets/index-maKIB4TF.js"]);

  for (const request of [
    sw.request("/api/bootstrap"),
    sw.request("/api/events"),
    sw.request("/assets/icon-192.png", { headers: new Headers({ range: "bytes=0-" }) }),
    sw.request("/assets/index-AAAAaaaa.js", { method: "POST" }),
    sw.request("https://elsewhere.test/assets/index-AAAAaaaa.js"),
    sw.request("/sw.js"),
  ]) {
    expect(await sw.dispatch("fetch", { request }), request.url).toBeUndefined();
  }
});

it("answers the page from the network, and from the cached shell only when offline", async () => {
  let online = true;
  const sw = worker((url) => {
    if (!online) throw new TypeError("offline");
    return ok(url.endsWith("/") ? PAGE : `body of ${url}`);
  });
  const navigate = sw.request("/", { mode: "navigate" });
  expect(await (await sw.dispatch("fetch", { request: navigate }))!.text()).toBe(PAGE);
  online = false;
  expect(await (await sw.dispatch("fetch", { request: navigate }))!.text()).toBe(PAGE);

  const cold = worker(() => {
    throw new TypeError("offline");
  });
  await expect(cold.dispatch("fetch", { request: navigate })).rejects.toThrow("offline");
});

it("refreshes other static files in the background and answers from the cache at once", async () => {
  let version = 1;
  const sw = worker(() => ok(`icon v${version}`));
  const icon = sw.request("/assets/icon-192.png");
  expect(await (await sw.dispatch("fetch", { request: icon }))!.text()).toBe("icon v1");
  version = 2;
  expect(await (await sw.dispatch("fetch", { request: icon }))!.text()).toBe("icon v1");
  expect(await (await sw.dispatch("fetch", { request: icon }))!.text()).toBe("icon v2");
});

it("keeps only complete, same-origin answers", async () => {
  const sw = worker((url) =>
    url.endsWith("api-BBBBbbbb.js") ? new Response("nope", { status: 500 }) : ok("fine"),
  );
  await sw.dispatch("fetch", { request: sw.request("/assets/api-BBBBbbbb.js") });
  await sw.dispatch("fetch", { request: sw.request("/assets/index-AAAAaaaa.js") });
  expect(
    [...(sw.stores.get("cc-assets-v1")?.keys() ?? [])].map((url) => new URL(url).pathname),
  ).toEqual(["/assets/index-AAAAaaaa.js"]);
});

it("shows a push with the gateway's latest notice, or a generic one when it can't be read", async () => {
  const notice = { title: "Atlas", body: "Done.", url: "/#/chat", tag: "reply-1" };
  const sw = worker(() => ok(JSON.stringify(notice)));
  await sw.dispatch("push");
  expect(sw.shown).toEqual([
    {
      title: "Atlas",
      body: "Done.",
      tag: "reply-1",
      renotify: true,
      icon: "/assets/icon-192.png",
      data: { url: `${ORIGIN}/#/chat` },
    },
  ]);
  const down = worker(() => new Response("no", { status: 503 }));
  await down.dispatch("push");
  expect(down.shown).toMatchObject([{ title: "Copilot", body: "Something needs your attention." }]);
});

describe("the app icon badge", () => {
  const push = () => ok(JSON.stringify({ title: "Atlas", body: "Replied." }));
  const hidden = { visibilityState: "hidden", focus: async () => {}, postMessage: () => {} };

  it("goes up with each push while no window is in front, from the count the page reported", async () => {
    const sw = worker(push, undefined, { windows: [hidden] });
    await sw.dispatch("message", { data: { type: "badge", count: 2 } });
    await sw.dispatch("push");
    await sw.dispatch("push");
    expect(sw.badges).toEqual([3, 4]);
    expect(sw.shown).toHaveLength(2);
    // A restarted worker reads the count back.
    const again = worker(push, sw.stores, { windows: [] });
    await again.dispatch("push");
    expect(again.badges).toEqual([5]);
  });

  it("is left to the page while a window is in front, and restarts from zero when the page says so", async () => {
    const front = { ...hidden, visibilityState: "visible" };
    const sw = worker(push, undefined, { windows: [front] });
    await sw.dispatch("push");
    expect(sw.badges).toEqual([]);
    expect(sw.shown).toHaveLength(1);
    await sw.dispatch("message", { data: { type: "badge", count: 4 } });
    const closed = worker(push, sw.stores);
    await closed.dispatch("message", { data: { type: "badge", count: 0 } });
    await closed.dispatch("push");
    expect(closed.badges).toEqual([1]);
    // Junk from a page is ignored.
    await closed.dispatch("message", { data: { type: "badge", count: -3 } });
    await closed.dispatch("message", { data: { type: "badge", count: "9" } });
    await closed.dispatch("push");
    expect(closed.badges).toEqual([1, 2]);
  });

  it("still shows the notice where the Badging API is missing", async () => {
    const sw = worker(push, undefined, { badging: false });
    await sw.dispatch("push");
    expect(sw.badges).toEqual([]);
    expect(sw.shown).toHaveLength(1);
  });
});

describe("tapping a notice", () => {
  it("tells an open app where to go and opens one only when none is open", async () => {
    const told: object[] = [];
    let focused = 0;
    const client = {
      visibilityState: "hidden",
      focus: async () => void focused++,
      postMessage: (message: object) => told.push(message),
    };
    const open = worker(() => ok(""), undefined, { windows: [client] });
    const close = () => {};
    await open.dispatch("notificationclick", {
      notification: { close, data: { url: `${ORIGIN}/#/chat` } },
    });
    expect(told).toEqual([{ type: "open", url: `${ORIGIN}/#/chat` }]);
    expect(focused).toBe(1);
    expect(open.opened).toEqual([]);
    const none = worker(() => ok(""));
    await none.dispatch("notificationclick", {
      notification: { close, data: { url: `${ORIGIN}/#/chat` } },
    });
    expect(none.opened).toEqual([`${ORIGIN}/#/chat`]);
  });
});
