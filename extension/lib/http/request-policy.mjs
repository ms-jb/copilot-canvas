import { ERROR_CODES, HEADERS, LIMITS } from "../../shared/contract.mjs";
import { checkOrigin, isAllowedHost, isJsonContentType, loopbackHost, loopbackOrigin, timingSafeEqualStrings, } from "../../shared/security.mjs";
import { baseHeaders, sendError } from "./responses.mjs";
export const isRead = (method) => method === "GET" || method === "HEAD";
function readBody(req, res) {
    return new Promise((resolveBody) => {
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) {
            resolveBody({ tooLarge: true });
            return;
        }
        const chunks = [];
        let total = 0;
        let done = false;
        const finish = (result) => {
            if (done)
                return;
            done = true;
            req.off("data", onData);
            resolveBody(result);
        };
        const onData = (chunk) => {
            total += chunk.length;
            if (total > LIMITS.maxBodyBytes) {
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
export function createRequestPolicy({ capabilityPath, generation, csrfToken, getPort, getSessionId, }) {
    function staleGeneration(req) {
        const header = req.headers[HEADERS.generation];
        return header !== undefined && !timingSafeEqualStrings(String(header), generation);
    }
    /** First gate for every route, including assets and unknown paths. Null means already answered. */
    function authorize(req, res) {
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
    async function readJsonPost(req, res, status) {
        const fail = (code, message, extra) => {
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
        const read = await readBody(req, res);
        if ("failed" in read)
            return undefined;
        if ("tooLarge" in read) {
            return fail(ERROR_CODES.payloadTooLarge, "Request body is too large.", {
                connection: "close",
            });
        }
        try {
            return { value: JSON.parse(read.body) };
        }
        catch {
            return fail(ERROR_CODES.badRequest, "Body is not valid JSON.");
        }
    }
    /** Payload validation and session binding are inseparable from POST admission. */
    async function readPost(req, res, status, validate) {
        const parsed = await readJsonPost(req, res, status);
        if (!parsed)
            return undefined;
        const validation = validate(parsed.value);
        if (!validation.ok) {
            sendError(res, validation.code, validation.message, status);
            return undefined;
        }
        if (validation.value.sessionId !== getSessionId()) {
            sendError(res, ERROR_CODES.sessionMismatch, "This panel belongs to a different session.", status);
            return undefined;
        }
        return validation.value;
    }
    return { authorize, staleGeneration, readPost };
}
