import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { ERROR_CODES } from "../../shared/contract.mts";
import type { Logger } from "../logging.mts";
import { baseHeaders, sendError } from "./responses.mts";

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
});
const APPLE_TOUCH_ICONS = new Set(["apple-touch-icon.png", "apple-touch-icon-precomposed.png"]);
function buildCsp(frameAncestors: string): string {
  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (frameAncestors) directives.push(`frame-ancestors ${frameAncestors}`);
  return directives.join("; ");
}
function fallbackPage(assistantName: string): string {
  const title = assistantName.replace(/[<>&"']/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:2rem;color:CanvasText;background:Canvas}code{font-family:ui-monospace,monospace}</style></head><body><h1>UI not built</h1><p>The renderer has not been built yet. Run <code>npx vp build</code> in the template repository, then reload extensions and reopen this canvas.</p></body></html>`;
}

export function createAssetHandler({
  uiDir,
  assistantName,
  frameAncestors,
  log,
}: {
  uiDir?: string;
  assistantName: string;
  frameAncestors: string;
  log: Logger;
}) {
  const uiRoot = uiDir ? resolve(uiDir) : null;
  const csp = buildCsp(frameAncestors);
  async function serveIndex(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let html: Buffer | null = null;
    if (uiRoot) {
      try {
        html = await readFile(resolve(uiRoot, "index.html"));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "ENOENT" && code !== "EISDIR") {
          log(`Could not read index.html: ${code ?? "error"}`, "warning");
        }
      }
    }
    const body = html ?? Buffer.from(fallbackPage(assistantName));
    res.writeHead(200, {
      ...baseHeaders("text/html; charset=utf-8"),
      "content-security-policy": csp,
      "content-length": body.length,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }
  async function serveAsset(
    req: IncomingMessage,
    res: ServerResponse,
    relative: string,
  ): Promise<void> {
    const notFound = (): void => sendError(res, ERROR_CODES.notFound, "Not found.");
    if (!uiRoot) return notFound();
    let decoded: string;
    try {
      decoded = decodeURIComponent(relative);
    } catch {
      return notFound();
    }
    if (decoded.includes("\0") || decoded.includes("\\")) return notFound();
    const segments = decoded.split("/");
    if (segments.some((s) => s === "" || s.startsWith(".") || s.includes(":"))) return notFound();
    const target = resolve(uiRoot, ...segments);
    if (!target.startsWith(uiRoot + sep)) return notFound();
    try {
      const [realTarget, realRoot] = await Promise.all([realpath(target), realpath(uiRoot)]);
      if (!realTarget.startsWith(realRoot + sep)) return notFound();
      const info = await stat(realTarget);
      if (!info.isFile()) return notFound();
      const path = segments.join("/");
      res.writeHead(200, {
        ...baseHeaders(MIME_TYPES[extname(realTarget).toLowerCase()] ?? "application/octet-stream"),
        ...(APPLE_TOUCH_ICONS.has(path)
          ? { "cache-control": "public, max-age=31536000, immutable" }
          : {}),
        "content-length": info.size,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(realTarget);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) notFound();
    }
  }
  return { serveIndex, serveAsset };
}
