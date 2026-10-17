import {
  API,
  ERROR_CODES,
  HEADERS,
  LIMITS,
  validateBootstrap,
  validateIdentity,
  type Bootstrap,
  type Identity,
} from "./shared";

export type ApiErrorKind = "network" | "http" | "invalid_response";

/** Typed failure for GET requests (bootstrap / identity). */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly httpStatus?: number;
  readonly code?: string;

  constructor(kind: ApiErrorKind, message: string, httpStatus?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/** Everything the composer needs to talk to the provider that served this page. */
export interface SendContext {
  sessionId: string;
  csrfToken: string;
  generation: string;
}

export type SendOutcome =
  | { kind: "accepted"; messageId?: string }
  | { kind: "rejected"; code?: string; message: string }
  // The request may or may not have reached the session. The caller must never auto-resend.
  | { kind: "uncertain"; message: string }
  | { kind: "stale"; message: string };

// Relative on purpose: the page may be served under a capability prefix or through the gateway.
const url = (path: string) => `./${path}`;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function field(body: unknown, key: string): string | undefined {
  if (typeof body === "object" && body !== null && key in body) {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url(path), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", "Could not reach the panel provider.");
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      "http",
      field(body, "message") ?? `Request failed (${response.status}).`,
      response.status,
      field(body, "code"),
    );
  }
  if (body === undefined) {
    throw new ApiError("invalid_response", "The provider sent an unreadable response.");
  }
  return body;
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  const body = await getJson(API.bootstrap, signal);
  if (!validateBootstrap(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible bootstrap response.");
  }
  return body;
}

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity> {
  const body = await getJson(API.identity, signal);
  if (!validateIdentity(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible identity response.");
  }
  return body;
}

/** Random id matching the contract's requestId pattern (A-Za-z0-9_-, 8-64 chars). */
export function makeRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const UNCERTAIN_MESSAGE =
  "Might not have been delivered — check the transcript before sending again.";

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
  let response: Response;
  try {
    response = await fetch(url(API.send), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [HEADERS.csrf]: context.csrfToken,
        [HEADERS.generation]: context.generation,
      },
      body: JSON.stringify({ requestId, sessionId: context.sessionId, text }),
      signal: controller.signal,
    });
  } catch {
    return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
  } finally {
    clearTimeout(timer);
  }

  const body = await readJson(response);
  const status = field(body, "status");
  const code = field(body, "code");

  if (code === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "Provider restarted — reload this panel." };
  }
  if (response.ok && status === "accepted") {
    return { kind: "accepted", messageId: field(body, "messageId") };
  }
  if (
    status === "uncertain" ||
    code === ERROR_CODES.sendUncertain ||
    code === ERROR_CODES.duplicateRequest
  ) {
    return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
  }
  if (
    status === "rejected" ||
    (body !== undefined && response.status >= 400 && response.status < 500)
  ) {
    return {
      kind: "rejected",
      code,
      message: field(body, "message") ?? `The message was not sent (${response.status}).`,
    };
  }
  if (response.status >= 400 && response.status < 500) {
    return { kind: "rejected", message: `The message was not sent (${response.status}).` };
  }
  return { kind: "uncertain", message: UNCERTAIN_MESSAGE };
}
