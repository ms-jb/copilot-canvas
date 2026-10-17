import { createPublicKey, verify } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { isAllowedPushEndpoint, openPushStore } from "../../gateway/push.mts";
import { APPLE, FCM, usePushDirectory } from "./fixtures.mts";

const directory = usePushDirectory();

it("accepts only https endpoints on known push services", () => {
  for (const ok of [APPLE, FCM, "https://updates.push.services.mozilla.com/wpush/v2/x"]) {
    expect(isAllowedPushEndpoint(ok)).toBe(true);
  }
  for (const bad of [
    "http://web.push.apple.com/x",
    "https://evilpush.apple.com/x",
    "https://push.apple.com.evil.test/x",
    "https://web.push.apple.com:8443/x",
    "https://user:pass@web.push.apple.com/x",
    "https://example.com/x",
    "not a url",
    42,
  ]) {
    expect(isAllowedPushEndpoint(bad)).toBe(false);
  }
});

it("signs a VAPID token the public key verifies, and caches it per push service", async () => {
  const calls: string[] = [];
  const store = openPushStore(join(directory(), "push.json"), async (_endpoint, authorization) => {
    calls.push(authorization);
    return 201;
  });
  store.add(APPLE);
  expect(await store.sendAll()).toBe(1);
  expect(await store.sendAll()).toBe(1);
  expect(calls[0]).toBe(calls[1]);

  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(calls[0] ?? "");
  expect(match?.[4]).toBe(store.publicKey);
  const [, header = "", claims = "", signature = ""] = match ?? [];
  const point = Buffer.from(store.publicKey, "base64url");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  const signed = Buffer.from(`${header}.${claims}`);
  const valid = verify(
    "sha256",
    signed,
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  expect(valid).toBe(true);
  expect(JSON.parse(Buffer.from(claims, "base64url").toString()).aud).toBe(
    "https://web.push.apple.com",
  );
});
