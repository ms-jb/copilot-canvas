import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { createAssetHandler } from "../../src/host/http/assets.mts";
import { createCompressor, pickEncoding } from "../../src/host/http/compression.mts";

const SCRIPT = `export const answer = ${JSON.stringify("x".repeat(4000))};\n`;
let dir: string;
let server: http.Server;

function get(path: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const port = (server.address() as AddressInfo).port;
      http
        .get({ host: "127.0.0.1", port, path, headers, agent: false }, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        })
        .on("error", reject);
    },
  );
}

beforeEach(async () => {
  dir = mkdtempSync(join(process.cwd(), "tests", "host", ".assets-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), `<!doctype html><title>t</title>${" ".repeat(2000)}`);
  writeFileSync(join(dir, "assets", "index-AbC_12-z.js"), SCRIPT);
  writeFileSync(join(dir, "assets", "icon.png"), Buffer.alloc(3000, 7));
  writeFileSync(join(dir, "apple-touch-icon.png"), Buffer.alloc(2048, 9));
  const assets = createAssetHandler({
    uiDir: dir,
    assistantName: "Test",
    frameAncestors: "",
    log: () => {},
  });
  server = http.createServer((req, res) => {
    const path = (req.url ?? "/").slice(1);
    void (path === "" ? assets.serveIndex(req, res) : assets.serveAsset(req, res, path));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

it("caches hashed chunks for a year and compresses them for the encodings a client accepts", async () => {
  const br = await get("/assets/index-AbC_12-z.js", { "accept-encoding": "gzip, br" });
  expect(br.status).toBe(200);
  expect(br.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(br.headers.pragma).toBeUndefined();
  expect(br.headers["x-content-type-options"]).toBe("nosniff");
  expect(br.headers["content-encoding"]).toBe("br");
  expect(br.headers.vary).toBe("accept-encoding");
  expect(Number(br.headers["content-length"])).toBe(br.body.length);
  expect(br.body.length).toBeLessThan(SCRIPT.length / 10);
  expect(brotliDecompressSync(br.body).toString()).toBe(SCRIPT);

  const gzip = await get("/assets/index-AbC_12-z.js", { "accept-encoding": "gzip, br;q=0" });
  expect(gzip.headers["content-encoding"]).toBe("gzip");
  expect(gunzipSync(gzip.body).toString()).toBe(SCRIPT);

  const plain = await get("/assets/index-AbC_12-z.js");
  expect(plain.headers["content-encoding"]).toBeUndefined();
  expect(plain.body.toString()).toBe(SCRIPT);
});

it("revalidates unhashed files and the page with an ETag", async () => {
  const icon = await get("/assets/icon.png", { "accept-encoding": "br" });
  expect(icon.headers["cache-control"]).toBe("no-cache");
  expect(icon.headers["content-encoding"]).toBeUndefined();
  expect(icon.body.length).toBe(3000);
  const again = await get("/assets/icon.png", { "if-none-match": String(icon.headers.etag) });
  expect(again.status).toBe(304);
  expect(again.body.length).toBe(0);

  const page = await get("/", { "accept-encoding": "gzip" });
  expect(page.headers["cache-control"]).toBe("no-cache");
  expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
  expect(page.headers["content-encoding"]).toBe("gzip");
  const cached = await get("/", { "if-none-match": String(page.headers.etag) });
  expect(cached.status).toBe(304);
  expect(cached.headers["content-security-policy"]).toContain("default-src 'none'");
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>new build</title>");
  expect((await get("/", { "if-none-match": String(page.headers.etag) })).status).toBe(200);
});

it("serves a root apple-touch fallback icon as png", async () => {
  const reply = await get("/apple-touch-icon.png");
  expect(reply.status).toBe(200);
  expect(reply.headers["content-type"]).toBe("image/png");
  expect(reply.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(reply.body.length).toBe(2048);
});

it("picks brotli, then gzip, honoring q=0 and wildcards", () => {
  expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
  expect(pickEncoding("gzip;q=1.0, br;q=0")).toBe("gzip");
  expect(pickEncoding("*")).toBe("br");
  expect(pickEncoding("identity")).toBeNull();
  expect(pickEncoding(undefined)).toBeNull();
});

it("compresses a file version once, even for concurrent requests", async () => {
  const compressor = createCompressor({ maxEntries: 1 });
  const body = Buffer.from(SCRIPT);
  const first = compressor.compress("a", body, "br");
  expect(compressor.compress("a", body, "br")).toBe(first);
  expect(compressor.compress("a", body, "gzip")).not.toBe(first);
  // Only the newest entry stays: "a" in brotli is compressed again.
  expect(compressor.compress("a", body, "br")).not.toBe(first);
  expect(brotliDecompressSync((await first)!).toString()).toBe(SCRIPT);
});
