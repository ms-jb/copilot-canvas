import { ATTACHMENT_LIMITS, ERROR_CODES, SEND_STATUS, validateControlsPayload, validateReloadPayload, validateRespondPayload, validateSendPayload, validateQueuePayload, } from "../../shared/contract.mjs";
import { ControlError } from "../controls/rpc-adapter.mjs";
import { errorMessage, sendError, sendJson, sendRejected, statusFor } from "./responses.mjs";
const MAX_TRACKED_SENDS = 500;
export function createPostRoutes(bridge, policy, log) {
    const sendOutcomes = new Map();
    function rememberOutcome(requestId, record) {
        sendOutcomes.set(requestId, record);
        if (sendOutcomes.size > MAX_TRACKED_SENDS) {
            const oldest = sendOutcomes.keys().next().value;
            if (oldest !== undefined)
                sendOutcomes.delete(oldest);
        }
    }
    function respondWithOutcome(res, outcome) {
        sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), outcome);
    }
    async function handleControls(req, res) {
        const payload = await policy.readPost(req, res, "error", validateControlsPayload);
        if (!payload)
            return;
        try {
            const controls = await bridge.applyControl(payload.change);
            sendJson(res, 200, { ok: true, controls });
        }
        catch (error) {
            if (error instanceof ControlError) {
                sendError(res, error.code, error.message);
                return;
            }
            log(`Control change failed: ${errorMessage(error)}`, "warning");
            sendError(res, ERROR_CODES.controlFailed, "The session did not apply the change.");
        }
    }
    async function handleReload(req, res) {
        const payload = await policy.readPost(req, res, "error", validateReloadPayload);
        if (!payload)
            return;
        if (!bridge.reloadExtensions()) {
            sendError(res, ERROR_CODES.reloadUnavailable, "This Copilot version cannot reload extensions from the canvas.");
            return;
        }
        sendJson(res, 200, { ok: true, status: "scheduled" });
    }
    async function handleStop(req, res) {
        const payload = await policy.readPost(req, res, "error", validateReloadPayload);
        if (!payload)
            return;
        const outcome = await bridge.stop();
        if (outcome === "unavailable") {
            sendError(res, ERROR_CODES.stopUnavailable, "This Copilot version cannot stop from the canvas.");
            return;
        }
        if (outcome === "failed") {
            sendError(res, ERROR_CODES.stopFailed, "The session didn't stop. Try again.");
            return;
        }
        sendJson(res, 200, { ok: true, status: "stopped" });
    }
    async function handleSend(req, res) {
        const payload = await policy.readPost(req, res, SEND_STATUS.rejected, validateSendPayload, ATTACHMENT_LIMITS.maxSendBodyBytes);
        if (!payload)
            return;
        const { requestId, text } = payload;
        // Synchronous guard: record the requestId before the first await below.
        const previous = sendOutcomes.get(requestId);
        if (previous) {
            if (previous.outcome)
                respondWithOutcome(res, previous.outcome);
            else
                sendRejected(res, ERROR_CODES.duplicateRequest, "This request is already being sent.");
            return;
        }
        const record = { outcome: null };
        rememberOutcome(requestId, record);
        let outcome;
        try {
            outcome = await bridge.send(text, requestId, payload.attachments, payload.mode);
        }
        catch (error) {
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
    async function handleRespond(req, res) {
        const payload = await policy.readPost(req, res, SEND_STATUS.rejected, validateRespondPayload);
        if (!payload)
            return;
        let outcome;
        try {
            outcome = await bridge.respond(payload.requestId, payload.response);
        }
        catch (error) {
            log(`Answer failed: ${errorMessage(error)}`, "warning");
            outcome = {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.respondFailed,
                message: "The session didn't accept the answer.",
            };
        }
        const body = outcome;
        sendJson(res, outcome.ok ? 200 : statusFor(outcome.code), body);
    }
    async function handleQueue(req, res) {
        const payload = await policy.readPost(req, res, "error", validateQueuePayload);
        if (!payload)
            return;
        const outcome = await bridge.changeQueue(payload.change).catch(() => "failed");
        if (outcome === "unavailable")
            return sendError(res, ERROR_CODES.queueUnavailable, "This session cannot change queued messages.");
        if (outcome === "gone")
            return sendError(res, ERROR_CODES.queueItemGone, "That message already left the queue.");
        if (outcome === "failed")
            return sendError(res, ERROR_CODES.queueFailed, "The queue didn't change. Try again.");
        sendJson(res, 200, { ok: true, status: "done" });
    }
    return { handleControls, handleReload, handleStop, handleSend, handleRespond, handleQueue };
}
