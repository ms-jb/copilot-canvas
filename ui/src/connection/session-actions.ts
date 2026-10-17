import { API, ERROR_CODES, LIMITS } from "../shared";
import { field, postJson, type SendContext } from "./http";

export type SendOutcome =
  | { kind: "accepted"; messageId?: string }
  | { kind: "rejected"; code?: string; message: string }
  // The request may or may not have reached the session. The caller must never auto-resend.
  | { kind: "uncertain"; message: string }
  | { kind: "stale"; message: string };

/** Random id matching the contract's requestId pattern (A-Za-z0-9_-, 8-64 chars). */
export function makeRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const UNCERTAIN_MESSAGE =
  "This message might not have been delivered. Check the transcript before you send it again.";

/**
 * Sends one prompt. The outcome is deliberately conservative: only a response that proves the
 * provider refused the request is "rejected". Anything ambiguous (network error, timeout,
 * unparsable 5xx) is "uncertain".
 */
export async function sendMessage(
  context: SendContext,
  requestId: string,
  text: string,
): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.sendTimeoutMs + 5000);
  let result: { status: number; body: unknown };
  try {
    result = await postJson(
      context,
      API.send,
      { requestId, sessionId: context.sessionId, text },
      controller.signal,
    );
  } catch {
    return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
  return sendOutcome(result.status, result.body);
}

export function sendOutcome(httpStatus: number, body: unknown): SendOutcome {
  const status = field(body, "status");
  const code = field(body, "code");
  const clientError = httpStatus >= 400 && httpStatus < 500;

  if (code === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (httpStatus >= 200 && httpStatus < 300 && status === "accepted") {
    return { kind: "accepted", messageId: field(body, "messageId") };
  }
  if (
    status === "uncertain" ||
    code === ERROR_CODES.sendUncertain ||
    code === ERROR_CODES.duplicateRequest
  ) {
    return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
  }
  if (status === "rejected" || clientError) {
    return {
      kind: "rejected",
      code,
      message: field(body, "message") ?? `The message was not sent (${httpStatus}).`,
    };
  }
  return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
}

export type ReloadOutcome =
  | { kind: "scheduled" }
  | { kind: "unavailable"; message: string }
  | { kind: "stale"; message: string };

/** Asks the host to reload this session's extensions; the canvas restarts with them. */
export async function requestReload(context: SendContext): Promise<ReloadOutcome> {
  let result: { status: number; body: unknown };
  try {
    result = await postJson(context, API.reload, { sessionId: context.sessionId });
  } catch {
    return { kind: "unavailable", message: "Couldn't reach the session. Try again." };
  }
  const { status, body } = result;
  if (field(body, "code") === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (status >= 200 && status < 300 && field(body, "status") === "scheduled") {
    return { kind: "scheduled" };
  }
  return {
    kind: "unavailable",
    message: field(body, "message") ?? "Reloading extensions isn't available here.",
  };
}

export type StopOutcome =
  | { kind: "stopped" }
  | { kind: "failed"; message: string }
  | { kind: "stale"; message: string };

/** Stops the session's running turn, the same as the app's own Stop. */
export async function requestStop(context: SendContext): Promise<StopOutcome> {
  let result: { status: number; body: unknown };
  try {
    result = await postJson(context, API.stop, { sessionId: context.sessionId });
  } catch {
    return { kind: "failed", message: "Couldn't reach the session. Try again." };
  }
  const { status, body } = result;
  if (field(body, "code") === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (status >= 200 && status < 300 && field(body, "status") === "stopped") {
    return { kind: "stopped" };
  }
  return { kind: "failed", message: field(body, "message") ?? "The session didn't stop." };
}
