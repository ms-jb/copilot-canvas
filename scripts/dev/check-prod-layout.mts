// Production-build layout and composer guard:
//
//   npm run build && node scripts/dev/check-prod-layout.mts [screenshot-dir]
//
// Serves the BUILT bundle (extension/ui) behind the dev mock's scripted data and opens it in one
// headless Chrome at 360x740, 768x900 and 1280x800, light and dark. `npx vp dev` orders CSS
// differently from the production build, so a bug that only the build shows (a panel squeezed by
// Mantine's own `overflow: hidden`, say) cannot be seen there. On each page it asserts:
//   - the page doesn't scroll sideways, and the composer sits inside the viewport (its toolbar fits
//     its own card: narrow on the phone);
//   - no interactive element is cut by a clipping ancestor before the scroll container that holds it,
//     and every composer button is at least 24px square;
//   - the microphone is named, shows its shortcut, and (with a fake SpeechRecognition) a recording
//     shows the interim words dimmed after the draft, Ctrl+Space stops it and the words join the
//     draft, a later phrase after a full stop;
//   - a message sent with Ctrl+Enter while the session works lands in the queue list;
//   - a reply that lands while the page is hidden counts as unread (a count on the Chat link and a
//     value passed to the Badging API), and showing the page reads it ("New" divider, count reset).
// Screenshots go to [screenshot-dir] when it is given. It exits 1 on any failure. Not part of
// `vp test`: it needs playwright-core and Chrome; set PLAYWRIGHT_MODULES to the folder holding
// playwright-core (default /tmp/pw/node_modules) and CHROME to the browser (default
// /usr/bin/google-chrome).
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { API, ERROR_CODES } from "../../src/shared/contract.mts";
import { loadConfig } from "../../src/shared/node/config.mts";
import { COOKIE } from "./fixtures.mts";
import { createMockHandler, error } from "./http.mts";
import { createScenarios } from "./scenarios.mts";
import { createSessions } from "./session.mts";

interface Page {
  setDefaultTimeout(ms: number): void;
  goto(url: string, options: object): Promise<unknown>;
  waitForSelector(selector: string, options?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T, A = undefined>(fn: (arg: A) => T, arg?: A): Promise<T>;
  click(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options: { path: string }): Promise<unknown>;
  addInitScript(script: string): Promise<void>;
  waitForFunction(fn: string, options?: object): Promise<unknown>;
}
interface Context {
  addCookies(cookies: object[]): Promise<void>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Browser {
  newContext(options: object): Promise<Context>;
  close(): Promise<void>;
}

const [shots] = process.argv.slice(2);
const root = join(fileURLToPath(import.meta.url), "../../..");
const dist = join(root, "extension/ui");
if (!existsSync(join(dist, "index.html"))) {
  console.error("No production bundle in extension/ui: run `npm run build` first.");
  process.exit(1);
}
if (shots) mkdirSync(shots, { recursive: true });

const modules = process.env.PLAYWRIGHT_MODULES ?? "/tmp/pw/node_modules/";
const { chromium } = createRequire(join(modules, "/"))("playwright-core") as {
  chromium: { launch(options: object): Promise<Browser> };
};

const sessions = createSessions();
const handle = createMockHandler({
  repoRoot: root,
  config: loadConfig(root),
  generation: `prod-check-${randomUUID().slice(0, 8)}`,
  sessions,
  scenarios: createScenarios(sessions),
});
const routes = new Set<string>(Object.values(API));
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

// A recognizer the page can drive: `window.__say(final, interim)` reports one result event.
const FAKE_RECOGNIZER = `(() => {
  class Fake {
    continuous = false; interimResults = false; lang = "";
    onaudiostart = null; onresult = null; onerror = null; onend = null;
    start() { window.__recognizer = this; setTimeout(() => this.onaudiostart?.(), 10); }
    stop() { setTimeout(() => this.onend?.(), 10); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = Fake;
  window.__say = (final, interim) => {
    const results = [];
    if (final) results.push(Object.assign([{ transcript: final }], { isFinal: true }));
    if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
    window.__recognizer.onresult({ resultIndex: 0, results });
  };
})();`;

// The Badging API and page visibility, recorded and driven from the test.
const BADGE_SHIM = `(() => {
  window.__badges = [];
  Object.defineProperty(navigator, "setAppBadge", { value: async (count) => window.__badges.push(count) });
  Object.defineProperty(navigator, "clearAppBadge", { value: async () => window.__badges.push("clear") });
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
  window.__setHidden = (next) => {
    hidden = next;
    document.dispatchEvent(new Event("visibilitychange"));
  };
})();`;

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
  const route = /(?:^|\/)(api(?:\/[a-z]+)+)$/.exec(pathname)?.[1];
  if (route && routes.has(route)) {
    handle(route, req, res).catch(() => {
      if (!res.headersSent) error(res, ERROR_CODES.internal, "Mock failed.");
    });
    return;
  }
  let file = normalize(join(dist, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(dist, "index.html");
  }
  if (file.endsWith("index.html")) {
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(readFileSync(file, "utf8"));
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

const sizes = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1280, height: 800 },
] as const;
const schemes = ["light", "dark"] as const;
const failures: string[] = [];
const fail = (label: string, message: string) => failures.push(`${label}: ${message}`);

/** Runs in the page: layout problems around the composer. */
function audit(): string[] {
  const problems: string[] = [];
  const name = (element: Element) =>
    `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}"`;
  const root = document.documentElement;
  if (root.scrollWidth > window.innerWidth + 1) {
    problems.push(`the page scrolls sideways (${root.scrollWidth}px in ${window.innerWidth}px)`);
  }
  const form = document.querySelector<HTMLElement>("form");
  const card = form?.querySelector<HTMLElement>("[data-composer-fit]");
  if (!form || !card) return [...problems, "the composer isn't on the page"];
  const box = card.getBoundingClientRect();
  if (box.left < -1 || box.right > window.innerWidth + 1 || box.bottom > window.innerHeight + 1) {
    problems.push("the composer is outside the viewport");
  }
  for (const control of form.querySelectorAll<HTMLElement>("button, textarea, [role=button]")) {
    if (!control.checkVisibility({ visibilityProperty: true })) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (control.tagName !== "TEXTAREA" && (rect.width < 24 || rect.height < 24)) {
      problems.push(`${name(control)} is ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    for (
      let node = control.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const { overflowX, overflowY } = getComputedStyle(node);
      const scrolls = (value: string) => value === "auto" || value === "scroll";
      if (scrolls(overflowX) || scrolls(overflowY)) break;
      const clips = (value: string) => value === "hidden" || value === "clip";
      if (!clips(overflowX) && !clips(overflowY)) continue;
      const edge = node.getBoundingClientRect();
      if (rect.left < edge.left - 1 || rect.right > edge.right + 1) {
        problems.push(`${name(control)} is cut at the side of ${name(node)}`);
      } else if (rect.top < edge.top - 1 || rect.bottom > edge.bottom + 1) {
        problems.push(`${name(control)} is cut above or below ${name(node)}`);
      }
    }
  }
  return problems;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--host-resolver-rules=MAP phone.test 127.0.0.1"],
});
try {
  for (const size of sizes) {
    for (const scheme of schemes) {
      const label = `${size.name} ${scheme}`;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        hasTouch: size.name === "phone",
      });
      await context.addCookies([{ name: COOKIE, value: "", url: base }]);
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      await page.addInitScript(FAKE_RECOGNIZER);
      await page.goto(base, { waitUntil: "load" });
      await page.waitForSelector("textarea");
      await page.waitForTimeout(800);
      for (const problem of await page.evaluate(audit)) fail(label, problem);
      const fit = await page.evaluate(() =>
        document.querySelector("[data-composer-fit]")?.getAttribute("data-composer-fit"),
      );
      // The toolbar fits its own card, not the window: side panes make a desktop card medium.
      if (size.name === "phone" && fit !== "narrow") fail(label, `composer fit is ${fit}`);
      console.log(`${label}: composer fit ${fit}`);
      if (shots)
        await page.screenshot({ path: join(shots, `composer-${size.name}-${scheme}.png`) });

      if (scheme === "light") {
        const mic = '[aria-keyshortcuts="Control+Space"]';
        await page.waitForSelector(mic);
        const named = await page.evaluate(
          (selector) => document.querySelector(selector)?.getAttribute("aria-label"),
          mic,
        );
        if (named !== "Dictate") fail(label, `the microphone is named ${named}`);
        await page.click(mic);
        await page.waitForSelector(`${mic}[aria-pressed="true"]`);
        await page.evaluate(() => (window as any).__say("", "hello there"));
        await page.waitForTimeout(200);
        const faded = await page.evaluate(() => {
          const field = document.querySelector("textarea");
          const mirror = document.querySelector<HTMLElement>('form [class*="mirror"]');
          const words = mirror?.querySelector<HTMLElement>("span");
          return {
            interim: field?.hasAttribute("data-interim"),
            value: field?.value,
            dimmed:
              !!mirror &&
              !!words &&
              getComputedStyle(words).color !== getComputedStyle(mirror).color,
          };
        });
        if (!faded.interim || faded.value !== "hello there" || !faded.dimmed) {
          fail(label, `interim words aren't shown dimmed in the field (${JSON.stringify(faded)})`);
        }
        if (shots) await page.screenshot({ path: join(shots, `dictation-${size.name}.png`) });
        await page.evaluate(() => (window as any).__say("hello there", ""));
        await page.evaluate(() => (window as any).__say("how are you", ""));
        await page.focus("textarea");
        await page.keyboard.press("Control+Space");
        await page.waitForSelector(`${mic}[aria-pressed="false"]`);
        const draft = await page.evaluate(() => document.querySelector("textarea")?.value);
        if (draft !== "hello there. how are you")
          fail(label, `the draft is ${JSON.stringify(draft)}`);
      }
      await context.close();
    }
  }

  // Queue: with the session working, Ctrl+Enter queues instead of steering.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: COOKIE, value: "busy", url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${base}?state=busy`, { waitUntil: "load" });
  await page.waitForSelector("textarea");
  await page.fill("textarea", "Queued from the production check");
  await page.keyboard.press("Control+Enter");
  try {
    await page.waitForSelector('[aria-label="Send queued message now"]');
    if (shots) await page.screenshot({ path: join(shots, "queue-desktop.png") });
  } catch {
    fail("queue", "a message sent with Ctrl+Enter didn't reach the queue list");
  }
  await context.close();

  // Unread, the "N new" divider and the app icon badge: a reply that lands while the page is
  // hidden counts, and reading it clears the count. A host name other than loopback makes the page
  // behave as the phone app does.
  for (const size of [sizes[2], sizes[0]]) {
    const phone = size.name === "phone";
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: phone,
    });
    await context.addCookies([{ name: COOKIE, value: "", url: base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.addInitScript(BADGE_SHIM);
    await page.goto(base.replace("127.0.0.1", "phone.test"), { waitUntil: "load" });
    await page.waitForSelector("textarea");
    await page.waitForFunction("window.__badges.length > 0");
    // The first visit offers notifications (a guide where push isn't available); dismiss it.
    await page.keyboard.press("Escape");
    // On the phone the Chat link is in a closed drawer: the count shows on the menu button instead.
    const holder = phone ? 'button[aria-label^="Open navigation"]' : 'nav a[href="#/chat"]';
    const named = phone ? `${holder}` : `${holder} [aria-label]`;
    await page.fill("textarea", "Anything new?");
    await page.keyboard.press("Enter");
    await page.evaluate(() => (window as any).__setHidden(true));
    try {
      await page.waitForFunction("window.__badges.at(-1) === 1");
      const count = await page.evaluate(
        (selector) => document.querySelector(selector)?.textContent,
        holder,
      );
      if (!count?.includes("1"))
        fail(`unread ${size.name}`, `the count shows ${JSON.stringify(count)}`);
      const label = await page.evaluate(
        (selector) => document.querySelector(selector)?.getAttribute("aria-label"),
        named,
      );
      if (!label?.includes("1 unread reply")) {
        fail(`unread ${size.name}`, `the count is named ${JSON.stringify(label)}`);
      }
      if (shots) await page.screenshot({ path: join(shots, `unread-count-${size.name}.png`) });
      await page.evaluate(() => (window as any).__setHidden(false));
      await page.waitForSelector("[data-unread-divider]");
      await page.waitForFunction("window.__badges.at(-1) === 'clear'");
      const after = await page.evaluate(
        (selector) =>
          /unread/.test(document.querySelector(selector)?.getAttribute("aria-label") ?? ""),
        named,
      );
      if (after) fail(`unread ${size.name}`, "the count stays after the reply was read");
      if (shots) await page.screenshot({ path: join(shots, `unread-divider-${size.name}.png`) });
    } catch (problem) {
      fail(
        `unread ${size.name}`,
        `a reply that landed while hidden wasn't counted: ${String(problem)}`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("production layout check passed");
