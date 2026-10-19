import type { IncomingMessage } from "node:http";
import { API, HEADERS } from "../../src/shared/contract.mts";
import { checkOrigin, isAllowedHost } from "../../src/shared/node/security.mts";

export const LOOPBACK = "127.0.0.1";

// Only these request headers reach the provider (no cookies, authorization or x-forwarded-*).
export const FORWARDED_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  // Compressed static files, and 304s for what the browser already has.
  "accept-encoding",
  "if-none-match",
  "if-modified-since",
  HEADERS.csrf,
  HEADERS.generation,
];

const ASSET_PATH = /^\/assets\/(?:[A-Za-z0-9._~@-]+\/)*[A-Za-z0-9._~@-]+$/;
const ROUTES: Record<string, string> = {
  "/": "GET",
  "/apple-touch-icon.png": "GET",
  "/apple-touch-icon-precomposed.png": "GET",
  [`/${API.identity}`]: "GET",
  [`/${API.bootstrap}`]: "GET",
  [`/${API.events}`]: "GET",
  [`/${API.send}`]: "POST",
  [`/${API.controls}`]: "POST",
  [`/${API.respond}`]: "POST",
  [`/${API.share}`]: "GET",
  [`/${API.sessions}`]: "GET",
  [`/${API.reload}`]: "POST",
  [`/${API.stop}`]: "POST",
  [`/${API.queue}`]: "POST",
  [`/${API.skills}`]: "GET",
  [`/${API.context}`]: "GET",
};

// Writes must be pinned to the provider run the page was loaded from.
export const PINNED_WRITES = new Set<string>([
  API.send,
  API.controls,
  API.respond,
  API.reload,
  API.stop,
  API.queue,
]);

export function allowedMethod(pathname: string): string | undefined {
  const isAsset = ASSET_PATH.test(pathname) && !pathname.split("/").includes("..");
  return isAsset ? "GET" : ROUTES[pathname];
}

export function acceptsRequest(request: IncomingMessage, port: number, allowedOrigin: string) {
  return (
    isAllowedHost(request.headers.host, [`127.0.0.1:${port}`, `localhost:${port}`]) &&
    checkOrigin({
      method: request.method ?? "GET",
      headers: request.headers,
      allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, allowedOrigin],
    })
  );
}

export function isStale(request: IncomingMessage, path: string, generation: string) {
  const pinned = request.headers[HEADERS.generation];
  return PINNED_WRITES.has(path)
    ? pinned !== generation
    : pinned !== undefined && pinned !== generation;
}
