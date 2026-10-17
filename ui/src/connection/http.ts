import { HEADERS } from "../shared";

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

// Relative on purpose: the page may be served under a capability prefix or through the gateway.
const url = (path: string) => `./${path}`;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function field(body: unknown, key: string): string | undefined {
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
