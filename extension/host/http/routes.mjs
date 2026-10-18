import { API, CONTRACT_VERSION, ERROR_CODES, IDENTITY_APP, toPublicOrigin, validateSessions, validateSkills, validateContextState, } from "../../shared/contract.mjs";
import { createPostRoutes } from "./post-routes.mjs";
import { isRead } from "./request-policy.mjs";
import { errorMessage, notAllowed, sendError, sendJson } from "./responses.mjs";
export function createRoutes({ config, bridge, generation, csrfToken, log, getSourceDir, getShareInfo, getSessions, policy, assets, events, }) {
    const posts = createPostRoutes(bridge, policy, log);
    function handleBootstrap(res) {
        const { snapshot, controls } = bridge.getSnapshot();
        let sourceDir = "";
        try {
            sourceDir = getSourceDir();
        }
        catch {
            // Only a hint for suggested prompts.
        }
        const body = {
            contractVersion: CONTRACT_VERSION,
            generation,
            sessionId: bridge.sessionId,
            csrfToken,
            config: {
                assistantName: config.assistantName,
                description: config.description,
                defaultView: config.defaultView,
                ...(sourceDir ? { sourceDir } : {}),
            },
            snapshot,
            controls,
        };
        sendJson(res, 200, body);
    }
    function handleShare(res) {
        let publicUrl = null;
        try {
            publicUrl = toPublicOrigin(getShareInfo().publicUrl);
        }
        catch (error) {
            log(`Could not read share info: ${errorMessage(error)}`, "warning");
        }
        const body = { publicUrl };
        sendJson(res, 200, body);
    }
    return async function route(req, res) {
        const relative = policy.authorize(req, res);
        if (relative === null)
            return;
        const method = req.method;
        if (relative === "" || relative === "index.html") {
            if (!isRead(method))
                return notAllowed(res, "GET, HEAD");
            return assets.serveIndex(req, res);
        }
        if (relative.startsWith("assets/")) {
            if (!isRead(method))
                return notAllowed(res, "GET, HEAD");
            return assets.serveAsset(req, res, relative);
        }
        switch (relative) {
            case API.identity: {
                if (method !== "GET")
                    return notAllowed(res, "GET");
                const identity = {
                    app: IDENTITY_APP,
                    contractVersion: CONTRACT_VERSION,
                    generation,
                };
                return sendJson(res, 200, identity);
            }
            case API.bootstrap:
                if (method !== "GET")
                    return notAllowed(res, "GET");
                return handleBootstrap(res);
            case API.events:
                if (method !== "GET")
                    return notAllowed(res, "GET");
                return events.handleEvents(req, res);
            case API.send:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleSend(req, res);
            case API.controls:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleControls(req, res);
            case API.respond:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleRespond(req, res);
            case API.reload:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleReload(req, res);
            case API.stop:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleStop(req, res);
            case API.queue:
                if (method !== "POST")
                    return notAllowed(res, "POST");
                return posts.handleQueue(req, res);
            case API.skills: {
                if (method !== "GET")
                    return notAllowed(res, "GET");
                const body = await bridge.listSkills().catch(() => null);
                if (!validateSkills(body))
                    return sendError(res, ERROR_CODES.internal, "Skills are unavailable.");
                return sendJson(res, 200, body);
            }
            case API.context: {
                if (method !== "GET")
                    return notAllowed(res, "GET");
                const body = await bridge.readContext().catch(() => null);
                if (!validateContextState(body))
                    return sendError(res, ERROR_CODES.internal, "Context usage is unavailable.");
                return sendJson(res, 200, body);
            }
            case API.share:
                if (method !== "GET")
                    return notAllowed(res, "GET");
                return handleShare(res);
            case API.sessions: {
                if (method !== "GET")
                    return notAllowed(res, "GET");
                const body = await getSessions().catch(() => null);
                if (!validateSessions(body)) {
                    return sendError(res, ERROR_CODES.internal, "Session list is unavailable.");
                }
                return sendJson(res, 200, body);
            }
            default:
                return sendError(res, ERROR_CODES.notFound, "Not found.");
        }
    };
}
