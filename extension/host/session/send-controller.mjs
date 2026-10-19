import { ERROR_CODES, SEND_STATUS } from "../../shared/contract.mjs";
import { describeSessionError } from "../logging.mjs";
import { createAttachmentStaging } from "./attachments.mjs";
const MAX_TRACKED_REQUESTS = 500;
/** Owns send admission and uncertainty; never retries a native call automatically. */
export function createSendController(session, { log, sendTimeoutMs, admit, }) {
    const requests = new Set();
    const staging = createAttachmentStaging();
    const cancelTimers = new Set();
    let disposed = false;
    function remember(requestId) {
        requests.add(requestId);
        if (requests.size > MAX_TRACKED_REQUESTS) {
            const oldest = requests.values().next().value;
            if (oldest !== undefined)
                requests.delete(oldest);
        }
    }
    async function send(text, requestId, attachments = [], mode = "immediate") {
        if (disposed) {
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.sendFailed,
                message: "The session is no longer connected.",
                requestId,
            };
        }
        // Recorded before any await so a repeat can never reach session.send twice.
        if (requests.has(requestId)) {
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.duplicateRequest,
                message: "This request was already submitted.",
                requestId,
            };
        }
        remember(requestId);
        let lease;
        try {
            if (attachments.length)
                lease = staging.stage(attachments);
        }
        catch (error) {
            requests.delete(requestId);
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.badRequest,
                message: error instanceof Error ? error.message : "Could not prepare the attachments.",
                requestId,
            };
        }
        const attempt = Promise.resolve()
            .then(() => {
            if (disposed)
                throw new Error("The session is no longer connected.");
            return session.send({
                prompt: text,
                mode,
                ...(lease ? { attachments: lease.attachments.slice() } : {}),
            });
        })
            .then((messageId) => ({ messageId }), (error) => ({ error }));
        let timer;
        let cancel = () => { };
        const timedOut = new Promise((resolve) => {
            cancel = () => resolve("timeout");
            cancelTimers.add(cancel);
            timer = setTimeout(cancel, sendTimeoutMs);
        });
        const winner = await Promise.race([attempt, timedOut]);
        lease?.release();
        clearTimeout(timer);
        cancelTimers.delete(cancel);
        if (winner === "timeout") {
            // The send may still land; tag it when it does, but never re-send.
            void attempt.then((late) => {
                if ("error" in late)
                    log(`Late send failure: ${describeSessionError(late.error)}`, "warning");
                else
                    admit(late.messageId, requestId, mode);
            });
            return {
                ok: false,
                status: SEND_STATUS.uncertain,
                code: ERROR_CODES.sendUncertain,
                requestId,
                message: "The session did not confirm the message in time. It might not have been delivered.",
            };
        }
        if ("error" in winner) {
            requests.delete(requestId);
            return {
                ok: false,
                status: SEND_STATUS.rejected,
                code: ERROR_CODES.sendFailed,
                message: describeSessionError(winner.error),
                requestId,
            };
        }
        admit(winner.messageId, requestId, mode);
        const outcome = { ok: true, status: SEND_STATUS.accepted, requestId };
        if (typeof winner.messageId === "string")
            outcome.messageId = winner.messageId;
        return outcome;
    }
    return {
        send,
        dispose() {
            disposed = true;
            staging.dispose();
            for (const cancel of Array.from(cancelTimers))
                cancel();
            cancelTimers.clear();
        },
    };
}
