import {
  API,
  ERROR_CODES,
  HEADERS,
  LIMITS,
  validateBootstrap,
  validateIdentity,
  type Bootstrap,
  type Identity,
  type PromptResponse,
} from "./shared";

export type ApiErrorKind = "network" | "http" | "invalid_response";

/** Typed request failure. `postJson` only throws the "network" kind. */
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

/** Everything a mutating request needs to talk to the provider that served this page. */
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

/**
 * GET a JSON resource. Throws ApiError for network failures, non-2xx responses and unreadable
 * bodies. The result is not validated: callers check the shape before trusting it.
 */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
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
  return body as T;
}

/**
 * POST JSON with the CSRF and provider-generation headers. Resolves with the HTTP status and the
 * parsed body (null when unreadable) for every response, including errors; throws ApiError only
 * when no response arrived. An abort through `signal` rethrows the abort error.
 */
export async function postJson<T = unknown>(
  context: SendContext,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; body: T | null }> {
  let response: Response;
  try {
    response = await fetch(url(path), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [HEADERS.csrf]: context.csrfToken,
        [HEADERS.generation]: context.generation,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", "Could not reach the panel provider.");
  }
  const parsed = await readJson(response);
  return { status: response.status, body: parsed === undefined ? null : (parsed as T) };
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  const body = await getJson<unknown>(API.bootstrap, signal);
  if (!validateBootstrap(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible bootstrap response.");
  }
  return body;
}

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity> {
  const body = await getJson<unknown>(API.identity, signal);
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

  const { status: httpStatus, body } = result;
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

export type RespondOutcome =
  | { kind: "accepted" }
  // Already answered elsewhere or no longer waiting: the card simply goes away.
  | { kind: "resolved" }
  | { kind: "rejected"; message: string }
  // The answer may or may not have applied. Never retried automatically.
  | { kind: "uncertain"; message: string }
  | { kind: "stale"; message: string };

const RESPOND_UNCERTAIN =
  "Couldn't confirm your answer reached Copilot. If this request is still here, answer it again.";

/** Sends the user's explicit answer to one pending prompt. */
export async function respondToPrompt(
  context: SendContext,
  requestId: string,
  response: PromptResponse,
): Promise<RespondOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.respondTimeoutMs + 10000);
  let result: { status: number; body: unknown };
  try {
    result = await postJson(
      context,
      API.respond,
      { sessionId: context.sessionId, requestId, response },
      controller.signal,
    );
  } catch {
    return { kind: "uncertain", message: RESPOND_UNCERTAIN };
  } finally {
    clearTimeout(timer);
  }
  const { status: httpStatus, body } = result;
  const code = field(body, "code");
  if (code === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (httpStatus >= 200 && httpStatus < 300 && field(body, "status") === "accepted") {
    return { kind: "accepted" };
  }
  if (code === ERROR_CODES.promptResolved) return { kind: "resolved" };
  if (code === ERROR_CODES.duplicateRequest) {
    return { kind: "rejected", message: "This request is already being answered." };
  }
  if (
    field(body, "status") === "uncertain" ||
    code === ERROR_CODES.respondUncertain ||
    code === ERROR_CODES.sendUncertain ||
    (httpStatus >= 500 && code === undefined)
  ) {
    return { kind: "uncertain", message: field(body, "message") ?? RESPOND_UNCERTAIN };
  }
  return {
    kind: "rejected",
    message: field(body, "message") ?? `The answer was not sent (${httpStatus}).`,
  };
}
