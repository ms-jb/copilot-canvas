import { expect, it } from "vite-plus/test";
import * as contract from "../src/shared/contract.mts";
import {
  CONTRACT_VERSION,
  IDENTITY_APP,
  LIMITS,
  toPublicOrigin,
  validateBootstrap,
  validateControlsPayload,
  validateIdentity,
  validateRespondPayload,
  validateSendPayload,
  validateServerEvent,
} from "../src/shared/contract.mts";

const entry = { id: "user:1", kind: "user", text: "hi", timestamp: "2026-01-01T00:00:00.000Z" };
const snapshot = { entries: [entry], status: { phase: "idle" } };
const controls = {
  available: { mode: true, model: true, reasoningEffort: false, contextTier: false },
  mode: "interactive",
  models: [],
};
const payload = { requestId: "abcd1234", sessionId: "session-1", text: "hello" };

it("keeps the public contract exports stable without exposing domain helpers", () => {
  expect(Object.keys(contract).sort()).toEqual([
    "ACTIVITIES",
    "API",
    "CONTEXT_TIERS",
    "CONTRACT_VERSION",
    "ENTRY_KINDS",
    "ERROR_CODES",
    "HEADERS",
    "HTTP_STATUS_BY_CODE",
    "IDENTITY_APP",
    "LIMITS",
    "PHASES",
    "PLAN_ACTIONS",
    "SEND_STATUS",
    "SESSION_MODES",
    "SSE_EVENTS",
    "WAITING_FOR",
    "isPlainObject",
    "makeError",
    "toPublicOrigin",
    "validateBootstrap",
    "validateControls",
    "validateControlsPayload",
    "validateEntry",
    "validateIdentity",
    "validatePrompt",
    "validatePrompts",
    "validateReloadPayload",
    "validateRespondPayload",
    "validateSendPayload",
    "validateServerEvent",
    "validateSnapshot",
    "validateStatus",
  ]);
});

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
  expect(validateServerEvent("snapshot", { seq: 0, generation: "g", snapshot, controls })).toBe(
    true,
  );
  expect(validateServerEvent("entry", { seq: 1, entry })).toBe(true);
  expect(validateServerEvent("status", { seq: 2, status: { phase: "working" } })).toBe(true);
  expect(validateServerEvent("entry", { seq: -1, entry })).toBe(false);
  expect(validateServerEvent("status", { seq: 1, status: { phase: "sleeping" } })).toBe(false);
  expect(validateServerEvent("controls", { seq: 3, controls })).toBe(true);
  expect(validateServerEvent("snapshot", { seq: 0, generation: "g", snapshot })).toBe(false);
  expect(validateServerEvent("other", { seq: 1 })).toBe(false);
});

it("validates bootstrap and identity", () => {
  const bootstrap = {
    contractVersion: CONTRACT_VERSION,
    generation: "gen-1234567890",
    sessionId: "s1",
    csrfToken: "token",
    config: { assistantName: "Copilot", defaultView: "chat" },
    snapshot,
    controls,
  };
  expect(validateBootstrap(bootstrap)).toBe(true);
  expect(validateBootstrap({ ...bootstrap, csrfToken: undefined })).toBe(false);
  const identity = { app: IDENTITY_APP, contractVersion: CONTRACT_VERSION, generation: "g" };
  expect(validateIdentity(identity)).toBe(true);
  expect(validateIdentity({ ...identity, app: "other" })).toBe(false);
});

it("accepts exactly one well-formed control change", () => {
  const ok = (change: unknown) => validateControlsPayload({ sessionId: "s1", change }).ok;
  expect(ok({ mode: "plan" })).toBe(true);
  expect(ok({ modelId: "model-a" })).toBe(true);
  expect(ok({ reasoningEffort: "high" })).toBe(true);
  expect(ok({ contextTier: "long_context" })).toBe(true);
  expect(ok({ mode: "yolo" })).toBe(false);
  expect(ok({ mode: "plan", modelId: "model-a" })).toBe(false);
  expect(ok({ approve: true })).toBe(false);
});

it("reduces public URLs to their origin", () => {
  expect(toPublicOrigin("https://host.example:8443/cap/secret?x=1")).toBe(
    "https://host.example:8443",
  );
  expect(toPublicOrigin("javascript:alert(1)")).toBeNull();
  expect(toPublicOrigin("")).toBeNull();
});

it("accepts only explicit, well-formed prompt answers", () => {
  const ok = (response: unknown) =>
    validateRespondPayload({ sessionId: "s1", requestId: "req-1", response }).ok;
  expect(ok({ kind: "permission", decision: "approve" })).toBe(true);
  expect(ok({ kind: "permission", decision: "deny" })).toBe(true);
  expect(ok({ kind: "question", answer: "Table", freeform: false })).toBe(true);
  expect(ok({ kind: "form", action: "accept", values: { name: "x", count: 2, ok: true } })).toBe(
    true,
  );
  expect(ok({ kind: "plan", approved: true, action: "interactive" })).toBe(true);
  expect(ok({ kind: "plan", approved: false, feedback: "Smaller steps" })).toBe(true);
  for (const bad of [
    { kind: "permission", decision: "approve-for-session" },
    { kind: "permission", decision: "approve", scope: "session" },
    { kind: "question", answer: "  ", freeform: true },
    { kind: "form", action: "decline", values: { a: 1 } },
    { kind: "form", action: "accept", values: { a: { nested: true } } },
    { kind: "plan", approved: true, action: "yolo" },
    { kind: "plan", approved: true },
    { kind: "other" },
  ]) {
    expect(ok(bad)).toBe(false);
  }
  expect(validateRespondPayload({ sessionId: "s1", requestId: "bad id", response: {} }).ok).toBe(
    false,
  );
});

it("validates the prompts event", () => {
  const prompt = {
    kind: "question",
    requestId: "req-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    question: "Which one?",
    choices: ["A", "B"],
    allowFreeform: false,
  };
  expect(validateServerEvent("prompts", { seq: 4, prompts: [prompt] })).toBe(true);
  expect(validateServerEvent("prompts", { seq: 4, prompts: [{ ...prompt, kind: "x" }] })).toBe(
    false,
  );
});
