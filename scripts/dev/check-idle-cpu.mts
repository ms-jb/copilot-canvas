// Idle CPU regression guard: loads pages in ONE headless Chrome, leaves them alone and reports how
// much CPU the renderer and GPU processes burn at rest.
//
//   npm run build
//   node scripts/dev/check-idle-cpu.mts [--url <base>] [--pages chat,...] [--seconds 20]
//                                       [--max 5] [--settle 4] [--width 1400] [--height 850]
//
// Without --url it starts scripts/dev/perf-stack.mts (the production build behind the real gateway)
// on a free port and stops it afterwards. Pass
// --url http://127.0.0.1:<port>/ to measure a dev server or another stack instead.
// It exits 1 if any page's renderer uses more than --max percent of one core (default 5).
// Not part of `vp test`: it needs Chrome and takes seconds per page. CPU time comes from CDP
// SystemInfo.getProcessInfo, so a loaded machine doesn't skew it much. Needs playwright-core and
// Chrome; set PLAYWRIGHT_MODULES to the folder holding playwright-core (default /tmp/pw/node_modules)
// and CHROME to the browser (default /usr/bin/google-chrome).
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

interface CdpSession {
  send(method: string, params?: object): Promise<unknown>;
}
interface Page {
  goto(url: string, options: object): Promise<unknown>;
  waitForSelector(selector: string, options?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}
interface Context {
  newPage(): Promise<Page>;
  newCDPSession(page: Page): Promise<CdpSession>;
  close(): Promise<void>;
}
interface Browser {
  newContext(options: object): Promise<Context>;
  newBrowserCDPSession(): Promise<CdpSession>;
  close(): Promise<void>;
}
interface ProcessInfo {
  type: string;
  id: number;
  cpuTime: number;
}

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    pages: { type: "string", default: "chat" },
    seconds: { type: "string", default: "20" },
    max: { type: "string", default: "5" },
    settle: { type: "string", default: "4" },
    width: { type: "string", default: "1400" },
    height: { type: "string", default: "850" },
    port: { type: "string", default: "47820" },
  },
});
const seconds = Number(values.seconds);
const maxPercent = Number(values.max);
const root = join(import.meta.dirname, "../..");
const modules = process.env.PLAYWRIGHT_MODULES ?? "/tmp/pw/node_modules/";
const { chromium } = createRequire(join(modules, "/"))("playwright-core") as {
  chromium: { launch(options: object): Promise<Browser> };
};

async function startStack(): Promise<{ url: string; stack: ChildProcess }> {
  const stack = spawn(
    process.execPath,
    [join(root, "scripts/dev/perf-stack.mts"), "--port", values.port!],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
  );
  const lines = createInterface({ input: stack.stdout! });
  for await (const line of lines) {
    if (line.startsWith("{"))
      return { url: (JSON.parse(line) as { gateway: string }).gateway, stack };
  }
  throw new Error("perf-stack exited before it printed its URL; did you run `npm run build`?");
}

const sample = async (cdp: CdpSession) =>
  ((await cdp.send("SystemInfo.getProcessInfo")) as { processInfo: ProcessInfo[] }).processInfo;

/** Percent of one core each process type used between two samples of the same processes. */
function usage(before: ProcessInfo[], after: ProcessInfo[], elapsed: number) {
  const start = new Map(before.map((process) => [process.id, process.cpuTime]));
  const byType: Record<string, number> = {};
  for (const process of after) {
    const used = process.cpuTime - (start.get(process.id) ?? 0);
    byType[process.type] = (byType[process.type] ?? 0) + (used / elapsed) * 100;
  }
  return byType;
}

const started = values.url ? null : await startStack();
const base = values.url ?? started!.url;
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
let failed = false;
try {
  const context = await browser.newContext({
    viewport: { width: Number(values.width), height: Number(values.height) },
  });
  const system = await browser.newBrowserCDPSession();
  for (const name of values.pages!.split(",")) {
    const page = await context.newPage();
    await page.goto(`${base}#/${name}`, { waitUntil: "load" });
    await page.waitForSelector("main", { timeout: 20_000 });
    await page.waitForTimeout(Number(values.settle) * 1000);
    const startedAt = Date.now();
    const before = await sample(system);
    await page.waitForTimeout(seconds * 1000);
    const after = await sample(system);
    const byType = usage(before, after, (Date.now() - startedAt) / 1000);
    const renderer = byType.renderer ?? 0;
    const gpu = byType.gpu ?? 0;
    const verdict = renderer > maxPercent ? "FAIL" : "ok";
    if (renderer > maxPercent) failed = true;
    console.log(
      `${verdict.padEnd(4)} ${name.padEnd(10)} renderer ${renderer.toFixed(1).padStart(5)}%  gpu ${gpu.toFixed(1).padStart(5)}%  (limit ${maxPercent}%, ${seconds}s)`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  started?.stack.kill();
}
process.exit(failed ? 1 : 0);
