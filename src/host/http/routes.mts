import type { IncomingMessage, ServerResponse } from "node:http";
import {
  API,
  CONTRACT_VERSION,
  ERROR_CODES,
  IDENTITY_APP,
  LIMITS,
  toPublicOrigin,
  validateSessions,
  validateSkills,
  validateContextState,
} from "../../shared/contract.mts";
import type { Bootstrap, Identity, ShareInfo } from "../../shared/contract.mts";
import type { SessionsInfo } from "../../shared/contract.mts";
import type { TemplateConfig } from "../../shared/node/config.mts";
import type { Bridge } from "../session/bridge.mts";
import type { Logger } from "../logging.mts";
import type { createAssetHandler } from "./assets.mts";
import type { createEventStream } from "./event-stream.mts";
import { createPostRoutes } from "./post-routes.mts";
import { isRead } from "./request-policy.mts";
import type { RequestPolicy } from "./request-policy.mts";
import { errorMessage, notAllowed, sendError, sendJson, sendReadJson } from "./responses.mts";

export function createRoutes({
  config,
  bridge,
  generation,
  csrfToken,
  log,
  getSourceDir,
  getShareInfo,
  getSessions,
  policy,
  assets,
  events,
}: {
  config: Pick<TemplateConfig, "assistantName" | "description" | "defaultView">;
  bridge: Bridge;
  generation: string;
  csrfToken: string;
  log: Logger;
  getSourceDir: () => string;
  getShareInfo: () => ShareInfo;
  getSessions: () => Promise<SessionsInfo>;
  policy: RequestPolicy;
  assets: ReturnType<typeof createAssetHandler>;
  events: ReturnType<typeof createEventStream>;
}) {
  const posts = createPostRoutes(bridge, policy, log);
  function handleBootstrap(res: ServerResponse): void {
    const { snapshot, controls } = bridge.getSnapshot();
    const { activity: _activity, ...snapshotRest } = snapshot;
    let sourceDir = "";
    try {
      sourceDir = getSourceDir();
    } catch {
      // Only a hint for suggested prompts.
    }
    const body: Bootstrap = {
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
      // The page opens the event stream at the same time, and its snapshot carries everything;
      // the latest turns here are enough to paint the conversation first.
      snapshot: {
        ...snapshotRest,
        entries: snapshot.entries.slice(-LIMITS.bootstrapEntries),
      },
      controls,
    };
    sendJson(res, 200, body);
  }
  function handleShare(res: ServerResponse): void {
    let publicUrl: string | null = null;
    try {
      publicUrl = toPublicOrigin(getShareInfo().publicUrl);
    } catch (error) {
      log(`Could not read share info: ${errorMessage(error)}`, "warning");
    }
    const body: ShareInfo = { publicUrl };
    sendReadJson(res, body);
  }
  return async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const relative = policy.authorize(req, res);
    if (relative === null) return;
    const method = req.method;
    if (relative === "" || relative === "index.html") {
      if (!isRead(method)) return notAllowed(res, "GET, HEAD");
      return assets.serveIndex(req, res);
    }
    if (relative.startsWith("assets/")) {
      if (!isRead(method)) return notAllowed(res, "GET, HEAD");
      return assets.serveAsset(req, res, relative);
    }
    switch (relative) {
      case API.identity: {
        if (method !== "GET") return notAllowed(res, "GET");
        const identity: Identity = {
          app: IDENTITY_APP,
          contractVersion: CONTRACT_VERSION,
          generation,
        };
        return sendJson(res, 200, identity);
      }
      case API.bootstrap:
        if (method !== "GET") return notAllowed(res, "GET");
        return handleBootstrap(res);
      case API.events:
        if (method !== "GET") return notAllowed(res, "GET");
        return events.handleEvents(req, res);
      case API.send:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleSend(req, res);
      case API.controls:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleControls(req, res);
      case API.respond:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleRespond(req, res);
      case API.reload:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleReload(req, res);
      case API.stop:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleStop(req, res);
      case API.queue:
        if (method !== "POST") return notAllowed(res, "POST");
        return posts.handleQueue(req, res);
      case API.skills: {
        if (method !== "GET") return notAllowed(res, "GET");
        const body = await bridge.listSkills().catch(() => null);
        if (!validateSkills(body))
          return sendError(res, ERROR_CODES.internal, "Skills are unavailable.");
        return sendReadJson(res, body);
      }
      case API.context: {
        if (method !== "GET") return notAllowed(res, "GET");
        const body = await bridge.readContext().catch(() => null);
        if (!validateContextState(body))
          return sendError(res, ERROR_CODES.internal, "Context usage is unavailable.");
        return sendReadJson(res, body);
      }
      case API.share:
        if (method !== "GET") return notAllowed(res, "GET");
        return handleShare(res);
      case API.sessions: {
        if (method !== "GET") return notAllowed(res, "GET");
        const body = await getSessions().catch(() => null);
        if (!validateSessions(body)) {
          return sendError(res, ERROR_CODES.internal, "Session list is unavailable.");
        }
        return sendReadJson(res, body);
      }
      default:
        return sendError(res, ERROR_CODES.notFound, "Not found.");
    }
  };
}
