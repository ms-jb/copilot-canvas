import { expect, it } from "vite-plus/test";
import {
  CONTRACT_VERSION,
  IDENTITY_APP,
  LIMITS,
  validateBootstrap,
  validateIdentity,
  validateSendPayload,
  validateServerEvent,
} from "../extension-src/shared/contract.mts";

const entry = { id: "user:1", kind: "user", text: "hi", timestamp: "2026-01-01T00:00:00.000Z" };
const snapshot = { entries: [entry], status: { phase: "idle" } };
const payload = { requestId: "abcd1234", sessionId: "session-1", text: "hello" };

it("accepts a valid send payload and rejects malformed ones", () => {
  expect(validateSendPayload(payload)).toEqual({ ok: true, value: payload });
  for (const bad of [
    null,
    { ...payload, extra: 1 },
    { ...payload, requestId: "bad/id" },
    { ...payload, sessionId: "" },
    { ...payload, text: "   " },
  ]) {
    expect(validateSendPayload(bad).ok).toBe(false);
  }
});

it("enforces the prompt length limit", () => {
  expect(validateSendPayload({ ...payload, text: "x".repeat(LIMITS.maxPromptChars) }).ok).toBe(
    true,
  );
  expect(validateSendPayload({ ...payload, text: "x".repeat(LIMITS.maxPromptChars + 1) }).ok).toBe(
    false,
  );
});

it("validates server events", () => {
  expect(validateServerEvent("snapshot", { seq: 0, generation: "g", snapshot })).toBe(true);
  expect(validateServerEvent("entry", { seq: 1, entry })).toBe(true);
  expect(validateServerEvent("status", { seq: 2, status: { phase: "working" } })).toBe(true);
  expect(validateServerEvent("entry", { seq: -1, entry })).toBe(false);
  expect(validateServerEvent("status", { seq: 1, status: { phase: "sleeping" } })).toBe(false);
  expect(validateServerEvent("other", { seq: 1 })).toBe(false);
});

it("validates bootstrap and identity", () => {
  const bootstrap = {
    contractVersion: CONTRACT_VERSION,
    generation: "gen-1234567890",
    sessionId: "s1",
    csrfToken: "token",
    config: { displayName: "Chat", defaultView: "chat" },
    snapshot,
  };
  expect(validateBootstrap(bootstrap)).toBe(true);
  expect(validateBootstrap({ ...bootstrap, csrfToken: undefined })).toBe(false);
  const identity = { app: IDENTITY_APP, contractVersion: CONTRACT_VERSION, generation: "g" };
  expect(validateIdentity(identity)).toBe(true);
  expect(validateIdentity({ ...identity, app: "other" })).toBe(false);
});
