import type { OutgoingHttpHeaders } from "node:http";
import { API } from "../../src/shared/contract.mts";

/**
 * Short in-memory copies of GET replies that are the same for every device (so each phone and
 * browser doesn't send its own read to the provider). Keyed by provider generation and path; a
 * restarted provider has a new generation, so nothing outlives it.
 */
const TTL_MS: Readonly<Record<string, number>> = Object.freeze({
  [API.skills]: 15_000,
});
const MAX_BODY_BYTES = 512 * 1024;

export interface CachedReply {
  headers: OutgoingHttpHeaders;
  body: Buffer;
  at: number;
}

export const isGetCached = (path: string) => path in TTL_MS;
/** Only a reply the provider marked for revalidation, never `no-store`, may be kept. */
export const isStorable = (status: number | undefined, headers: OutgoingHttpHeaders) =>
  status === 200 &&
  headers["cache-control"] === "private, no-cache" &&
  typeof headers.etag === "string" &&
  headers["set-cookie"] === undefined;

export function createGetCache(now: () => number = Date.now) {
  const entries = new Map<string, CachedReply>();
  const key = (generation: string, path: string) => `${generation}\n${path}`;
  return {
    get(generation: string, path: string): CachedReply | undefined {
      const entry = entries.get(key(generation, path));
      return entry && now() - entry.at < (TTL_MS[path] ?? 0) ? entry : undefined;
    },
    set(generation: string, path: string, headers: OutgoingHttpHeaders, body: Buffer): void {
      if (!isGetCached(path) || body.length > MAX_BODY_BYTES) return;
      for (const old of entries.keys()) if (!old.startsWith(`${generation}\n`)) entries.delete(old);
      entries.set(key(generation, path), { headers, body, at: now() });
    },
    /** A write through the gateway changes what the provider would answer. */
    clear(path: string): void {
      for (const old of entries.keys()) if (old.endsWith(`\n${path}`)) entries.delete(old);
    },
  };
}
