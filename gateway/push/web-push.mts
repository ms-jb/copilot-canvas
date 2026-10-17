import { sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import https from "node:https";

// Push services of Safari, Chrome, Firefox and Edge. Matched exactly or on a dot boundary.
const PUSH_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];
const MAX_ENDPOINT_LENGTH = 1024;
const VAPID_SUBJECT = "https://github.com/ms-jb/copilot-canvas";
const JWT_LIFETIME_S = 12 * 60 * 60;
const SEND_TIMEOUT_MS = 10_000;

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
