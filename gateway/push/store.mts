import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { writePrivateJson } from "../../extension-src/shared/runtime-state.mts";
import { isAllowedPushEndpoint, sendPush, vapidAuthorization } from "./web-push.mts";
import type { PushSender } from "./web-push.mts";

const MAX_ENDPOINTS = 10;
// Apple asks senders not to refresh the token more than once an hour.
const JWT_REUSE_MS = 60 * 60 * 1000;

interface PushFile {
  publicKey: string;
  privateKey: JsonWebKey;
  endpoints: string[];
}

function readPushFile(path: string): PushFile | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<PushFile>;
    if (typeof value.publicKey !== "string" || typeof value.privateKey !== "object") return null;
    const endpoints = Array.isArray(value.endpoints) ? value.endpoints : [];
    return {
      publicKey: value.publicKey,
      privateKey: value.privateKey,
      endpoints: endpoints.filter(isAllowedPushEndpoint).slice(-MAX_ENDPOINTS),
    };
  } catch {
    return null;
  }
}

function createPushFile(): PushFile {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(String(jwk.x), "base64url"),
    Buffer.from(String(jwk.y), "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk, endpoints: [] };
}

export interface PushStore {
  /** Application server key for `pushManager.subscribe`, base64url. */
  publicKey: string;
  endpoints(): readonly string[];
  add(endpoint: string): void;
  remove(endpoint: string): void;
  /** Pushes to every subscription not skipped and drops those the push service reports gone. */
  sendAll(skip?: (endpoint: string) => boolean): Promise<number>;
}

/** Opens (creating on first use) the private push file at `path`. */
export function openPushStore(path: string, sender: PushSender = sendPush): PushStore {
  const file = readPushFile(path) ?? createPushFile();
  const privateKey = createPrivateKey({ key: file.privateKey, format: "jwk" });
  const save = () => writePrivateJson(path, file);
  save();

  const tokens = new Map<string, { value: string; at: number }>();
  const authorization = (endpoint: string) => {
    const audience = new URL(endpoint).origin;
    const now = Date.now();
    const cached = tokens.get(audience);
    if (cached && now - cached.at < JWT_REUSE_MS) return cached.value;
    const value = vapidAuthorization(endpoint, privateKey, file.publicKey, now);
    tokens.set(audience, { value, at: now });
    return value;
  };

  const remove = (endpoint: string) => {
    const before = file.endpoints.length;
    file.endpoints = file.endpoints.filter((existing) => existing !== endpoint);
    if (file.endpoints.length !== before) save();
  };

  return {
    publicKey: file.publicKey,
    endpoints: () => file.endpoints,
    add(endpoint) {
      file.endpoints = [...file.endpoints.filter((e) => e !== endpoint), endpoint].slice(
        -MAX_ENDPOINTS,
      );
      save();
    },
    remove,
    async sendAll(skip) {
      const targets = skip ? file.endpoints.filter((endpoint) => !skip(endpoint)) : file.endpoints;
      const results = await Promise.all(
        targets.map(async (endpoint) => {
          const status = await sender(endpoint, authorization(endpoint));
          if (status === 404 || status === 410) remove(endpoint);
          return status >= 200 && status < 300;
        }),
      );
      return results.filter(Boolean).length;
    },
  };
}
