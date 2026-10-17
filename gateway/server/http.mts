import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { API, ERROR_CODES, HTTP_STATUS_BY_CODE } from "../../extension-src/shared/contract.mts";
import { SENSITIVE_RESPONSE_HEADERS } from "../../extension-src/shared/security.mts";

const NOT_CONNECTED_PAGE = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Not connected</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color-scheme:light dark}</style>
<h1>Not connected</h1>
<p>Copilot Canvas isn't running. Open the canvas in a Copilot chat and this page reconnects on its own.</p>
`;

/** Reads the body, or resolves null when it exceeds `maxBytes` or the client goes away. */
export function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) done(null);
      else chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", () => done(null));
  });
}

export function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...SENSITIVE_RESPONSE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  response.end(body);
}

export function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  code: string,
  message: string,
) {
  const isPost = request.method === "POST";
  const isSend = isPost && request.url?.split("?")[0] === `/${API.send}`;
  const body = Buffer.from(
    JSON.stringify({
      ok: false,
      code,
      message,
      ...(isSend && { status: code === ERROR_CODES.sendUncertain ? "uncertain" : "rejected" }),
    }),
  );
  const headers: OutgoingHttpHeaders = {
    ...SENSITIVE_RESPONSE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  };
  if (isPost) {
    // The request body may be unread: discard it and close the connection after replying.
    headers.connection = "close";
    request.resume();
  }
  response.writeHead(HTTP_STATUS_BY_CODE[code] ?? 500, headers);
  response.end(body);
}

export function sendNotConnected(
  request: IncomingMessage,
  response: ServerResponse,
  isIndex: boolean,
) {
  if (!isIndex)
    return sendError(request, response, ERROR_CODES.notConnected, "Provider not connected.");
  response.writeHead(503, {
    ...SENSITIVE_RESPONSE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
  });
  response.end(NOT_CONNECTED_PAGE);
}
