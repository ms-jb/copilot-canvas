import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ATTACHMENT_LIMITS,
  ERROR_CODES,
  SEND_STATUS,
  validateControlsPayload,
  validateReloadPayload,
  validateRespondPayload,
  validateSendPayload,
} from "../../shared/contract.mts";
import type { RespondResult } from "../../shared/contract.mts";
import type { Bridge } from "../session/bridge.mts";
import type { SendOutcome } from "../session/send-controller.mts";
import { ControlError } from "../controls/rpc-adapter.mts";
import type { RespondOutcome } from "../prompts/rpc-adapter.mts";
import type { Logger } from "../logging.mts";
import type { RequestPolicy } from "./request-policy.mts";
import { errorMessage, sendError, sendJson, sendRejected, statusFor } from "./responses.mts";

const MAX_TRACKED_SENDS = 500;

export function createPostRoutes(bridge: Bridge, policy: RequestPolicy, log: Logger) {
  const sendOutcomes = new Map<string, { outcome: SendOutcome | null }>();
  function rememberOutcome(requestId: string, record: { outcome: SendOutcome | null }): void {
    sendOutcomes.set(requestId, record);
    if (sendOutcomes.size > MAX_TRACKED_SENDS) {
      const oldest = sendOutcomes.keys().next().value;
      if (oldest !== undefined) sendOutcomes.delete(oldest);
    }
  }
  function respondWithOutcome(res: ServerResponse, outcome: SendOutcome): void {
    sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), outcome);
  }
  async function handleControls(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await policy.readPost(req, res, "error", validateControlsPayload);
    if (!payload) return;
    try {
      const controls = await bridge.applyControl(payload.change);
      sendJson(res, 200, { ok: true, controls });
    } catch (error) {
      if (error instanceof ControlError) {
        sendError(res, error.code, error.message);
        return;
      }
      log(`Control change failed: ${errorMessage(error)}`, "warning");
      sendError(res, ERROR_CODES.controlFailed, "The session did not apply the change.");
    }
  }
  async function handleReload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await policy.readPost(req, res, "error", validateReloadPayload);
    if (!payload) return;
    if (!bridge.reloadExtensions()) {
      sendError(
        res,
        ERROR_CODES.reloadUnavailable,
        "This Copilot version cannot reload extensions from the canvas.",
      );
      return;
    }
    sendJson(res, 200, { ok: true, status: "scheduled" });
  }
  async function handleStop(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await policy.readPost(req, res, "error", validateReloadPayload);
    if (!payload) return;
    const outcome = await bridge.stop();
    if (outcome === "unavailable") {
      sendError(
        res,
        ERROR_CODES.stopUnavailable,
        "This Copilot version cannot stop from the canvas.",
      );
      return;
    }
    if (outcome === "failed") {
      sendError(res, ERROR_CODES.stopFailed, "The session didn't stop. Try again.");
      return;
    }
    sendJson(res, 200, { ok: true, status: "stopped" });
  }
  async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await policy.readPost(
      req,
      res,
      SEND_STATUS.rejected,
      validateSendPayload,
      ATTACHMENT_LIMITS.maxSendBodyBytes,
    );
    if (!payload) return;
    const { requestId, text } = payload;
    // Synchronous guard: record the requestId before the first await below.
    const previous = sendOutcomes.get(requestId);
    if (previous) {
      if (previous.outcome) respondWithOutcome(res, previous.outcome);
      else sendRejected(res, ERROR_CODES.duplicateRequest, "This request is already being sent.");
      return;
    }
    const record: { outcome: SendOutcome | null } = { outcome: null };
    rememberOutcome(requestId, record);
    let outcome: SendOutcome;
    try {
      outcome = await bridge.send(text, requestId, payload.attachments, payload.mode);
    } catch (error) {
      log(`Send failed: ${errorMessage(error)}`, "warning");
      outcome = {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.sendFailed,
        message: "The session did not accept the message.",
        requestId,
      };
    }
    record.outcome = outcome;
    respondWithOutcome(res, outcome);
  }
  async function handleRespond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await policy.readPost(req, res, SEND_STATUS.rejected, validateRespondPayload);
    if (!payload) return;
    let outcome: RespondOutcome;
    try {
      outcome = await bridge.respond(payload.requestId, payload.response);
    } catch (error) {
      log(`Answer failed: ${errorMessage(error)}`, "warning");
      outcome = {
        ok: false,
        status: SEND_STATUS.rejected,
        code: ERROR_CODES.respondFailed,
        message: "The session didn't accept the answer.",
      };
    }
    const body: RespondResult = outcome;
    sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), body);
  }
  return { handleControls, handleReload, handleStop, handleSend, handleRespond };
}
