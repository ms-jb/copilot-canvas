// Brotli or gzip for the renderer's text files, compressed once per file version and kept in memory.
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

export type Encoding = "br" | "gzip";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
// Below this, headers outweigh the savings.
const MIN_BYTES = 1024;
const TEXT_TYPE = /^(?:text\/|application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)/;
// Quality 9 is within 8% of 11 on the main chunk at a thirtieth of the time (about 0.1 s).
const BROTLI_QUALITY = 9;

export function isCompressible(contentType: string, size: number): boolean {
  return size >= MIN_BYTES && TEXT_TYPE.test(contentType);
}

/** The best encoding `accept-encoding` allows: brotli, then gzip; null for none. */
export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  if (typeof header !== "string") return null;
  const accepted = new Map<string, number>();
  for (const part of header.toLowerCase().split(",")) {
    const [name = "", ...params] = part.split(";").map((value) => value.trim());
    const q = params.find((param) => param.startsWith("q="));
    accepted.set(name, q ? Number(q.slice(2)) || 0 : 1);
  }
  const allows = (name: Encoding) => (accepted.get(name) ?? accepted.get("*") ?? 0) > 0;
  return allows("br") ? "br" : allows("gzip") ? "gzip" : null;
}

/**
 * Compresses each `key` once: concurrent requests share the work, and the newest `maxEntries`
 * results stay cached. Resolves null when compression fails, so the caller sends the file as is.
 */
export function createCompressor({ maxEntries = 48 }: { maxEntries?: number } = {}) {
  const cache = new Map<string, Promise<Buffer | null>>();
  return {
    compress(key: string, body: Buffer, encoding: Encoding): Promise<Buffer | null> {
      const id = `${encoding}:${key}`;
      let result = cache.get(id);
      if (result) {
        cache.delete(id);
      } else {
        result = (
          encoding === "br"
            ? brotli(body, {
                params: {
                  [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                  [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
                },
              })
            : gzipAsync(body, { level: 9 })
        ).catch(() => {
          cache.delete(id);
          return null;
        });
      }
      cache.set(id, result);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return result;
    },
  };
}
