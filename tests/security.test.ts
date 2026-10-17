import { expect, it } from "vite-plus/test";
import {
  checkOrigin,
  isAllowedHost,
  loopbackHost,
  loopbackOrigin,
} from "../extension-src/shared/security.mts";

const hosts = [loopbackHost(4000), "localhost:4000"];
const origins = [loopbackOrigin(4000)];

it("accepts only exact loopback Hosts", () => {
  expect(isAllowedHost("127.0.0.1:4000", hosts)).toBe(true);
  expect(isAllowedHost("LOCALHOST:4000", hosts)).toBe(true);
  for (const bad of [
    "127.0.0.1:4001",
    "127.0.0.1",
    "example.com",
    "127.0.0.1:4000.evil.test",
    "",
  ]) {
    expect(isAllowedHost(bad, hosts)).toBe(false);
  }
  expect(isAllowedHost(undefined, hosts)).toBe(false);
});

it("requires an allowed Origin on POST", () => {
  const post = (headers: Record<string, string>) =>
    checkOrigin({ method: "POST", headers, allowedOrigins: origins });
  expect(post({})).toBe(false);
  expect(post({ origin: "https://evil.test" })).toBe(false);
  expect(post({ origin: "null" })).toBe(false);
  expect(post({ origin: "http://127.0.0.1:4000" })).toBe(true);
  expect(post({ origin: "http://127.0.0.1:4000", "sec-fetch-site": "cross-site" })).toBe(false);
});

it("lets GET omit Origin but not send a foreign one", () => {
  const get = (headers: Record<string, string>) =>
    checkOrigin({ method: "GET", headers, allowedOrigins: origins });
  expect(get({})).toBe(true);
  expect(get({ origin: "https://evil.test" })).toBe(false);
});
