import { ERROR_CODES, SEND_STATUS } from "../../shared/contract.mjs";
import { isRecord } from "./descriptions.mjs";
import { checkFormValues } from "./form-values.mjs";
export const RESOLVED_MESSAGE = "This request was already answered or is no longer waiting.";
export const rejected = (code, message) => ({
    ok: false,
    status: SEND_STATUS.rejected,
    code,
    message,
});
export function describeError(error) {
    const message = error instanceof Error ? error.message : "";
    return message.replace(/\s+/g, " ").trim().slice(0, 300);
}
export function createPromptsRpcAdapter(session, { timeoutMs, log }) {
    const cancels = new Set();
    // Looked up on every use: the experimental surface may change shape at runtime.
    const permissions = () => session.rpc?.permissions;
    const ui = () => session.rpc?.ui;
    const can = {
        permission: () => typeof permissions()?.handlePendingPermissionRequest === "function",
        list: () => typeof permissions()?.pendingRequests === "function",
        question: () => typeof ui()?.handlePendingUserInput === "function",
        form: () => typeof ui()?.handlePendingElicitation === "function",
        plan: () => typeof ui()?.handlePendingExitPlanMode === "function",
    };
    /** Builds the native call without executing it or choosing a decision. */
    function prepare(prompt, response) {
        const requestId = prompt.requestId;
        if (response.kind !== prompt.kind) {
            return rejected(ERROR_CODES.badRequest, "That answer doesn't match this request.");
        }
        const unavailable = rejected(ERROR_CODES.promptUnavailable, "This request can't be answered from the canvas.");
        if (response.kind === "permission") {
            const handler = permissions()?.handlePendingPermissionRequest;
            if (typeof handler !== "function")
                return unavailable;
            return () => handler.call(permissions(), {
                requestId,
                result: response.decision === "approve"
                    ? { kind: "approve-once", approvedInteractively: true }
                    : { kind: "reject" },
                decisionContext: {
                    outcome: "prompted_user",
                    source: "human_response",
                    surface: "sdk",
                    responseCapability: "interactive",
                },
            });
        }
        if (response.kind === "question" && prompt.kind === "question") {
            const handler = ui()?.handlePendingUserInput;
            if (typeof handler !== "function")
                return unavailable;
            if (response.freeform ? !prompt.allowFreeform : !prompt.choices.includes(response.answer)) {
                return rejected(ERROR_CODES.badRequest, response.freeform
                    ? "This question only takes one of its choices."
                    : "That isn't one of the choices.");
            }
            return () => handler.call(ui(), {
                requestId,
                response: { answer: response.answer, wasFreeform: response.freeform },
            });
        }
        if (response.kind === "form" && prompt.kind === "form") {
            const handler = ui()?.handlePendingElicitation;
            if (typeof handler !== "function")
                return unavailable;
            if (response.action !== "accept") {
                return () => handler.call(ui(), { requestId, result: { action: response.action } });
            }
            if (!prompt.supported)
                return unavailable;
            const content = checkFormValues(prompt, response.values);
            if (typeof content === "string")
                return rejected(ERROR_CODES.badRequest, content);
            return () => handler.call(ui(), { requestId, result: { action: "accept", content } });
        }
        if (response.kind === "plan" && prompt.kind === "plan") {
            const handler = ui()?.handlePendingExitPlanMode;
            if (typeof handler !== "function")
                return unavailable;
            if (response.approved) {
                if (!prompt.actions.includes(response.action)) {
                    return rejected(ERROR_CODES.badRequest, "That isn't one of the plan's actions.");
                }
                return () => handler.call(ui(), {
                    requestId,
                    response: { approved: true, selectedAction: response.action },
                });
            }
            const feedback = response.feedback?.trim();
            return () => handler.call(ui(), {
                requestId,
                response: feedback ? { approved: false, feedback } : { approved: false },
            });
        }
        return rejected(ERROR_CODES.badRequest, "That answer doesn't match this request.");
    }
    async function execute(call, onSettled) {
        const attempt = Promise.resolve()
            .then(call)
            .then((result) => ({ result }), (error) => ({ error }));
        // Notify on actual settlement, not timeout: the service keeps the answer guarded until then.
        const finished = attempt.then((outcome) => {
            onSettled(!("error" in outcome));
            return outcome;
        });
        let timer;
        let cancel = () => { };
        const timedOut = new Promise((resolve) => {
            cancel = () => resolve("timeout");
            cancels.add(cancel);
            timer = setTimeout(cancel, timeoutMs);
        });
        const winner = await Promise.race([finished, timedOut]);
        clearTimeout(timer);
        cancels.delete(cancel);
        if (winner === "timeout") {
            void finished.then((late) => {
                if ("error" in late)
                    log(`Late prompt answer failed: ${describeError(late.error)}`, "warning");
            });
            return {
                ok: false,
                status: SEND_STATUS.uncertain,
                code: ERROR_CODES.respondUncertain,
                message: "The session didn't confirm your answer in time. It may still apply.",
            };
        }
        if ("error" in winner) {
            log(`Prompt answer failed: ${describeError(winner.error)}`, "warning");
            return rejected(ERROR_CODES.respondFailed, describeError(winner.error) || "The session didn't accept the answer.");
        }
        if (isRecord(winner.result) && winner.result.success === true) {
            return { ok: true, status: SEND_STATUS.accepted };
        }
        return rejected(ERROR_CODES.promptResolved, RESOLVED_MESSAGE);
    }
    return {
        can,
        prepare,
        execute,
        async readPending() {
            const reader = permissions()?.pendingRequests;
            if (typeof reader !== "function" || !can.permission())
                return undefined;
            return reader.call(permissions());
        },
        dispose() {
            for (const cancel of Array.from(cancels))
                cancel();
            cancels.clear();
        },
    };
}
