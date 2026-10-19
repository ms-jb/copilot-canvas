import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { isWithinActiveHours, normalizeActiveHours } from "../../src/shared/contract.mts";
import type { ActiveHours } from "../../src/shared/contract.mts";
import { writePrivateJson } from "../../src/shared/node/runtime-state.mts";
import { isAllowedPushEndpoint, sendPush, vapidAuthorization } from "./web-push.mts";
import type { PushSender } from "./web-push.mts";

const MAX_ENDPOINTS = 10;
// Apple asks senders not to refresh the token more than once an hour.
const JWT_REUSE_MS = 60 * 60 * 1000;

interface PushSubscription {
  endpoint: string;
  activeHours?: ActiveHours;
}

interface PushFile {
  publicKey: string;
  privateKey: JsonWebKey;
  subscriptions: PushSubscription[];
  /** Legacy format, migrated on read. */
  endpoints?: string[];
}

function sameActiveHours(a: ActiveHours | undefined, b: ActiveHours | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.on === b.on &&
    a.start === b.start &&
    a.end === b.end &&
    a.zone === b.zone &&
    a.days.length === b.days.length &&
    a.days.every((day, index) => day === b.days[index])
  );
}

function normalizeSubscription(value: unknown): PushSubscription | null {
  if (typeof value === "string") return isAllowedPushEndpoint(value) ? { endpoint: value } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const endpoint = Reflect.get(value, "endpoint");
  if (!isAllowedPushEndpoint(endpoint)) return null;
  const activeHours = normalizeActiveHours(Reflect.get(value, "activeHours")) ?? undefined;
  return activeHours ? { endpoint, activeHours } : { endpoint };
}

function readPushFile(path: string): PushFile | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<PushFile>;
    if (typeof value.publicKey !== "string" || typeof value.privateKey !== "object") return null;
    const saved =
      Array.isArray(value.subscriptions) && value.subscriptions.length > 0
        ? value.subscriptions
        : Array.isArray(value.endpoints)
          ? value.endpoints
          : [];
    const unique = new Map<string, PushSubscription>();
    for (const item of saved) {
      const subscription = normalizeSubscription(item);
      if (!subscription) continue;
      unique.delete(subscription.endpoint);
      unique.set(subscription.endpoint, subscription);
    }
    return {
      publicKey: value.publicKey,
      privateKey: value.privateKey,
      subscriptions: [...unique.values()].slice(-MAX_ENDPOINTS),
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
  return { publicKey: point.toString("base64url"), privateKey: jwk, subscriptions: [] };
}

export interface SendAllOptions {
  skip?: (endpoint: string) => boolean;
  /** True for urgent notices that must bypass per-device active hours. */
  ignoreActiveHours?: boolean;
  nowMs?: number;
}

export interface PushStore {
  /** Application server key for `pushManager.subscribe`, base64url. */
  publicKey: string;
  endpoints(): readonly string[];
  add(endpoint: string, options?: { activeHours?: ActiveHours }): void;
  setActiveHours(endpoint: string, activeHours: ActiveHours): boolean;
  activeHours(endpoint: string): ActiveHours | null;
  remove(endpoint: string): void;
  /** Pushes to every subscription not skipped and drops those the push service reports gone. */
  sendAll(options?: SendAllOptions | ((endpoint: string) => boolean)): Promise<number>;
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
    const before = file.subscriptions.length;
    file.subscriptions = file.subscriptions.filter((existing) => existing.endpoint !== endpoint);
    if (file.subscriptions.length !== before) save();
  };

  return {
    publicKey: file.publicKey,
    endpoints: () => file.subscriptions.map((subscription) => subscription.endpoint),
    activeHours(endpoint) {
      return (
        file.subscriptions.find((subscription) => subscription.endpoint === endpoint)
          ?.activeHours ?? null
      );
    },
    add(endpoint, options = {}) {
      const existing = file.subscriptions.find(
        (subscription) => subscription.endpoint === endpoint,
      );
      const next: PushSubscription = {
        endpoint,
        ...(options.activeHours ? { activeHours: options.activeHours } : {}),
      };
      if (!options.activeHours && existing?.activeHours) next.activeHours = existing.activeHours;
      file.subscriptions = [
        ...file.subscriptions.filter((subscription) => subscription.endpoint !== endpoint),
        next,
      ].slice(-MAX_ENDPOINTS);
      save();
    },
    setActiveHours(endpoint, activeHours) {
      const index = file.subscriptions.findIndex(
        (subscription) => subscription.endpoint === endpoint,
      );
      if (index < 0) return false;
      const current = file.subscriptions[index];
      if (!current || sameActiveHours(current.activeHours, activeHours)) return true;
      file.subscriptions[index] = { ...current, activeHours };
      save();
      return true;
    },
    remove,
    async sendAll(options = {}) {
      const parsed = typeof options === "function" ? { skip: options } : options;
      const now = parsed.nowMs ?? Date.now();
      const targets = file.subscriptions.filter((subscription) => {
        if (parsed.skip?.(subscription.endpoint)) return false;
        if (parsed.ignoreActiveHours) return true;
        return isWithinActiveHours(subscription.activeHours, new Date(now));
      });
      const results = await Promise.all(
        targets.map(async ({ endpoint }) => {
          const status = await sender(endpoint, authorization(endpoint));
          if (status === 404 || status === 410) remove(endpoint);
          return status >= 200 && status < 300;
        }),
      );
      return results.filter(Boolean).length;
    },
  };
}
