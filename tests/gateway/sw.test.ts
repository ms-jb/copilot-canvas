import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";

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
) {
  const handlers = new Map<string, Handler>();
  const fetched: string[] = [];
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
    clients: { claim: async () => {} },
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
  return { dispatch, request, stores, fetched };
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
