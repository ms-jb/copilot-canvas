// Web Push for the phone. The VAPID keys and subscriptions stay in the runtime folder on this
// computer. Pushes carry no payload, so nothing about the conversation passes through a push
// service: when one arrives, the phone's service worker asks this gateway for a one-line status.

import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { PendingPrompt, SessionStatus } from "../extension-src/shared/contract.mts";
import { writePrivateJson } from "../extension-src/shared/runtime-state.mts";

// Push services of Safari, Chrome, Firefox and Edge. Matched exactly or on a dot boundary.
const PUSH_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];
const MAX_ENDPOINTS = 10;
const MAX_ENDPOINT_LENGTH = 1024;
const VAPID_SUBJECT = "https://github.com/ms-jb/copilot-canvas";
const JWT_LIFETIME_S = 12 * 60 * 60;
// Apple asks senders not to refresh the token more than once an hour.
const JWT_REUSE_MS = 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
// A status change and its prompt arrive separately; one request should buzz the phone once.
const WAITING_DEDUPE_MS = 3000;

export interface Notice {
  title: string;
  body: string;
}

/** Sends one empty push; resolves with the push service's HTTP status, or 0 when unreachable. */
export type PushSender = (endpoint: string, authorization: string) => Promise<number>;

/** True for an https URL on a known push service: default port, no credentials. */
export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** `Authorization` header for one push service, signed with the VAPID key (RFC 8292). */
export function vapidAuthorization(
  endpoint: string,
  privateKey: KeyObject,
  publicKey: string,
  nowMs = Date.now(),
): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_S,
    sub: VAPID_SUBJECT,
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${publicKey}`;
}

export const sendPush: PushSender = (endpoint, authorization) =>
  new Promise((done) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        agent: false,
        timeout: SEND_TIMEOUT_MS,
        // Topic lets the push service replace an undelivered push with the newer one.
        headers: {
          authorization,
          ttl: "3600",
          urgency: "high",
          topic: "copilot-canvas",
          "content-length": 0,
        },
      },
      (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => done(0));
    request.end();
  });

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
  /** Pushes to every subscription and drops those the push service reports gone. */
  sendAll(): Promise<number>;
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
    async sendAll() {
      const results = await Promise.all(
        file.endpoints.map(async (endpoint) => {
          const status = await sender(endpoint, authorization(endpoint));
          if (status === 404 || status === 410) remove(endpoint);
          return status >= 200 && status < 300;
        }),
      );
      return results.filter(Boolean).length;
    },
  };
}

function waitingBody(kind: string | undefined): string {
  switch (kind) {
    case "permission":
      return "Waiting for your permission.";
    case "question":
    case "input":
      return "Has a question for you.";
    case "form":
    case "elicitation":
      return "Needs a few details from you.";
    case "plan":
      return "Has a plan ready for you to review.";
    default:
      return "Waiting for you.";
  }
}

export interface Notifier {
  /** A (re)connected stream's first event. A new provider run starts from scratch. */
  snapshot(
    generation: string,
    status: SessionStatus,
    prompts: PendingPrompt[],
    nowMs?: number,
  ): Notice | null;
  status(next: SessionStatus, nowMs?: number): Notice | null;
  prompts(list: PendingPrompt[], nowMs?: number): Notice | null;
}

/**
 * Turns the provider's event stream into at most one notice per moment that needs the user: a new
 * pending request (or entering "waiting"), and a finished turn. Reconnecting to the same provider
 * run never repeats a notice.
 */
export function createNotifier(assistantName: string): Notifier {
  let generation: string | null = null;
  let current: SessionStatus | null = null;
  let seen = new Set<string>();
  let lastWaitingAt = -Infinity;

  const waiting = (kind: string | undefined, now: number): Notice | null => {
    if (now - lastWaitingAt < WAITING_DEDUPE_MS) return null;
    lastWaitingAt = now;
    return { title: `${assistantName} needs you`, body: waitingBody(kind) };
  };

  const onPrompts = (list: PendingPrompt[], now: number): Notice | null => {
    const fresh = list.find((prompt) => !seen.has(prompt.requestId));
    seen = new Set(list.map((prompt) => prompt.requestId));
    return fresh ? waiting(fresh.kind, now) : null;
  };

  const onStatus = (next: SessionStatus, now: number): Notice | null => {
    const previous = current;
    current = next;
    if (
      next.phase === "waiting" &&
      !(previous?.phase === "waiting" && previous.waitingFor === next.waitingFor)
    ) {
      return waiting(next.waitingFor, now);
    }
    if (previous?.phase === "working" && next.phase === "idle") {
      return { title: `${assistantName} finished`, body: "Ready for your next step." };
    }
    return null;
  };

  return {
    snapshot(nextGeneration, status, prompts, now = Date.now()) {
      if (nextGeneration !== generation) {
        generation = nextGeneration;
        current = null;
        seen = new Set();
        lastWaitingAt = -Infinity;
      }
      const fromPrompts = onPrompts(prompts, now);
      return onStatus(status, now) ?? fromPrompts;
    },
    status: (next, now = Date.now()) => onStatus(next, now),
    prompts: (list, now = Date.now()) => onPrompts(list, now),
  };
}

/** Splits buffered Server-Sent Events into complete `{ event, data }` frames plus the remainder. */
export function parseSse(buffer: string): {
  frames: { event: string; data: string }[];
  rest: string;
} {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  const frames = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}
