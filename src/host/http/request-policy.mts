import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { ERROR_CODES, HEADERS, LIMITS } from "../../shared/contract.mts";
import type { ValidationResult } from "../../shared/contract.mts";
import {
  checkOrigin,
  isAllowedHost,
  isJsonContentType,
  loopbackHost,
  loopbackOrigin,
  timingSafeEqualStrings,
} from "../../shared/node/security.mts";
import { baseHeaders, sendError } from "./responses.mts";

type BodyResult = { body: string } | { tooLarge: true } | { failed: true };
export const isRead = (method: string | undefined): boolean =>
  method === "GET" || method === "HEAD";

function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<BodyResult> {
  return new Promise((resolveBody) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      resolveBody({ tooLarge: true });
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (result: BodyResult): void => {
      if (done) return;
      done = true;
      req.off("data", onData);
      resolveBody(result);
    };
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > maxBytes) {
        finish({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => finish({ body: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => finish({ failed: true }));
    req.on("aborted", () => finish({ failed: true }));
    res.on("close", () => finish({ failed: true }));
  });
}

export function createRequestPolicy({
  capabilityPath,
  generation,
  csrfToken,
  getPort,
  getSessionId,
}: {
  capabilityPath: string;
  generation: string;
  csrfToken: string;
  getPort: () => number;
  getSessionId: () => string;
}) {
  function staleGeneration(req: IncomingMessage): boolean {
    const header = req.headers[HEADERS.generation];
    return header !== undefined && !timingSafeEqualStrings(String(header), generation);
  }
  /** First gate for every route, including assets and unknown paths. Null means already answered. */
  function authorize(req: IncomingMessage, res: ServerResponse): string | null {
    if (!isAllowedHost(req.headers.host, [loopbackHost(getPort())])) {
      sendError(res, ERROR_CODES.forbidden, "Forbidden.");
      return null;
    }
    const allowedOrigins = [loopbackOrigin(getPort())];
    if (!checkOrigin({ method: req.method ?? "", headers: req.headers, allowedOrigins })) {
      sendError(res, ERROR_CODES.forbidden, "Forbidden.");
      return null;
    }
    const rawUrl = req.url ?? "";
    const queryIndex = rawUrl.indexOf("?");
    const pathname = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
    if (isRead(req.method) && timingSafeEqualStrings(pathname + "/", capabilityPath)) {
      res.writeHead(308, { location: capabilityPath, ...baseHeaders() });
      res.end();
      return null;
    }
    if (!timingSafeEqualStrings(pathname.slice(0, capabilityPath.length), capabilityPath)) {
      sendError(res, ERROR_CODES.notFound, "Not found.");
      return null;
    }
    return pathname.slice(capabilityPath.length);
  }
  /** Shared CSRF, generation, media-type, size and JSON checks for every state-changing POST. */
  async function readJsonPost(
    req: IncomingMessage,
    res: ServerResponse,
    status: string,
    maxBytes: number,
  ): Promise<{ value: unknown } | undefined> {
    const fail = (code: string, message: string, extra?: OutgoingHttpHeaders): undefined => {
      sendError(res, code, message, status, extra);
      return undefined;
    };
    const providedCsrf = req.headers[HEADERS.csrf];
    if (typeof providedCsrf !== "string" || !timingSafeEqualStrings(providedCsrf, csrfToken)) {
      return fail(ERROR_CODES.forbidden, "Missing or invalid CSRF token.");
    }
    if (staleGeneration(req)) {
      return fail(ERROR_CODES.staleProvider, "The provider was restarted. Reload the page.");
    }
    if (!isJsonContentType(req.headers["content-type"])) {
      return fail(ERROR_CODES.unsupportedMediaType, "Content-Type must be application/json.");
    }
    const read = await readBody(req, res, maxBytes);
    if ("failed" in read) return undefined;
    if ("tooLarge" in read) {
      return fail(ERROR_CODES.payloadTooLarge, "Request body is too large.", {
        connection: "close",
      });
    }
    try {
      return { value: JSON.parse(read.body) as unknown };
    } catch {
      return fail(ERROR_CODES.badRequest, "Body is not valid JSON.");
    }
  }
  /** Payload validation and session binding are inseparable from POST admission. */
  async function readPost<T extends { sessionId: string }>(
    req: IncomingMessage,
    res: ServerResponse,
    status: string,
    validate: (value: unknown) => ValidationResult<T>,
    maxBytes: number = LIMITS.maxBodyBytes,
  ): Promise<T | undefined> {
    const parsed = await readJsonPost(req, res, status, maxBytes);
    if (!parsed) return undefined;
    const validation = validate(parsed.value);
    if (!validation.ok) {
      sendError(res, validation.code, validation.message, status);
      return undefined;
    }
    if (validation.value.sessionId !== getSessionId()) {
      sendError(
        res,
        ERROR_CODES.sessionMismatch,
        "This panel belongs to a different session.",
        status,
      );
      return undefined;
    }
    return validation.value;
  }
  return { authorize, staleGeneration, readPost };
}
export type RequestPolicy = ReturnType<typeof createRequestPolicy>;
