import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { publishQr } from "../../gateway/qr.mts";

const fakeUqr = {
  renderSVG: (text: string) => `<svg>${text}</svg>`,
  renderUnicodeCompact: () => "##",
} as unknown as typeof import("uqr");

const missing = async (): Promise<typeof import("uqr")> => {
  throw new Error("Cannot find package 'uqr'");
};

let directory = "";
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "qr-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("writes the image and prints the path when uqr is available", async () => {
  const lines: string[] = [];
  const imagePath = join(directory, "phone-qr.svg");
  const qr = publishQr({
    url: "https://x-47600.usw2.devtunnels.ms",
    imagePath,
    importUqr: async () => fakeUqr,
    log: (line) => lines.push(line),
  });
  expect(await qr.done).toBe(true);
  expect(readFileSync(imagePath, "utf8")).toBe("<svg>https://x-47600.usw2.devtunnels.ms</svg>");
  expect(lines.join("\n")).toContain(`QR image: ${imagePath}`);
});

it("keeps trying until uqr is installed", async () => {
  let calls = 0;
  const imagePath = join(directory, "phone-qr.svg");
  const qr = publishQr({
    url: "https://x",
    imagePath,
    retryMs: 5,
    log: () => {},
    importUqr: async () => {
      return ++calls < 3 ? missing() : fakeUqr;
    },
  });
  expect(await qr.done).toBe(true);
  expect(calls).toBe(3);
  expect(existsSync(imagePath)).toBe(true);
});

it("gives up after its attempts and writes nothing", async () => {
  const imagePath = join(directory, "phone-qr.svg");
  const qr = publishQr({
    url: "https://x",
    imagePath,
    retryMs: 1,
    attempts: 2,
    log: () => {},
    importUqr: missing,
  });
  expect(await qr.done).toBe(false);
  expect(existsSync(imagePath)).toBe(false);
});

it("stops retrying when asked", async () => {
  const qr = publishQr({
    url: "https://x",
    imagePath: join(directory, "phone-qr.svg"),
    retryMs: 60_000,
    log: () => {},
    importUqr: missing,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  qr.stop();
  expect(await qr.done).toBe(false);
});
