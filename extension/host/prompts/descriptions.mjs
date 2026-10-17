import { LIMITS, PLAN_ACTIONS } from "../../shared/contract.mjs";
export const MAX_SUBJECT = 120;
export const MAX_INTENT = 600;
export const MAX_LABEL = 200;
export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export function clip(value, size) {
    let text;
    if (typeof value === "string")
        text = value;
    else if (value === undefined || value === null)
        text = "";
    else {
        try {
            text = JSON.stringify(value, null, 2) ?? "";
        }
        catch {
            text = "";
        }
    }
    return text.length > size ? `${text.slice(0, size)}…` : text;
}
export const optional = (value, size) => {
    const text = clip(value, size).trim();
    return text ? text : undefined;
};
const lines = (...parts) => parts.filter((part) => typeof part === "string" && part.length > 0).join("\n");
/** Maps a native permission prompt to display-safe text. Only strings ever leave this function. */
export function describePermission(requestId, createdAt, request) {
    const detailMax = LIMITS.maxPromptDetailChars;
    const base = { kind: "permission", requestId, createdAt };
    const make = (permission, detail, extra = {}) => {
        const prompt = { ...base, permission, detail };
        if (extra.subject)
            prompt.subject = extra.subject;
        if (extra.intent)
            prompt.intent = extra.intent;
        if (extra.warning)
            prompt.warning = extra.warning;
        return prompt;
    };
    if (!isRecord(request))
        return make("other", "");
    const intent = optional(request.intention, MAX_INTENT);
    const bypass = request.requestSandboxBypass === true
        ? lines("Runs outside the sandbox.", optional(request.requestSandboxBypassReason, MAX_INTENT))
        : undefined;
    const warning = optional(lines(optional(request.warning, MAX_INTENT), bypass), MAX_INTENT * 2);
    switch (request.kind) {
        case "commands":
        case "shell":
            return make("command", clip(request.fullCommandText, detailMax), { intent, warning });
        case "write":
            return make("write", clip(lines(clip(request.fileName, MAX_LABEL), clip(request.diff, detailMax)), detailMax), { intent });
        case "read":
            return make("read", clip(request.path, detailMax), { intent });
        case "path": {
            const paths = Array.isArray(request.paths)
                ? request.paths.filter((p) => typeof p === "string").join("\n")
                : "";
            return make("path", clip(paths, detailMax), {
                subject: optional(request.accessKind, MAX_SUBJECT),
            });
        }
        case "url":
            return make("url", clip(request.url, detailMax), { intent, warning });
        case "mcp": {
            const tool = optional(request.toolTitle || request.toolName, MAX_SUBJECT);
            const server = optional(request.serverName, MAX_SUBJECT);
            return make("mcp", clip(request.args, detailMax), {
                subject: [server, tool].filter(Boolean).join(": ") || undefined,
            });
        }
        case "custom-tool":
            return make("tool", clip(request.args, detailMax), {
                subject: optional(request.toolName, MAX_SUBJECT),
                intent: optional(request.toolDescription, MAX_INTENT),
            });
        case "hook":
            return make("tool", clip(request.toolArgs, detailMax), {
                subject: optional(request.toolName, MAX_SUBJECT),
                intent: optional(request.hookMessage, MAX_INTENT),
            });
        case "memory":
            return make("memory", clip(request.fact, detailMax), {
                subject: optional(request.subject, MAX_SUBJECT),
            });
        case "extension-management":
            return make("extension", clip(request.extensionName, MAX_LABEL), {
                subject: optional(request.operation, MAX_SUBJECT),
            });
        case "extension-permission-access":
            return make("extension", clip(Array.isArray(request.capabilities) ? request.capabilities.join("\n") : "", detailMax), { subject: optional(request.extensionName, MAX_SUBJECT) });
        case "extension-env-access":
            return make("extension", clip(Array.isArray(request.environmentVariables)
                ? request.environmentVariables.join("\n")
                : "", detailMax), { subject: optional(request.extensionName, MAX_SUBJECT) });
        case "workflow":
            return make("workflow", clip(request.description, detailMax), {
                subject: optional(request.name, MAX_SUBJECT),
            });
        default:
            return make("other", "", { subject: optional(request.kind, MAX_SUBJECT) });
    }
}
export function describeQuestion(requestId, createdAt, data) {
    const choices = Array.isArray(data.choices)
        ? data.choices
            .filter((choice) => typeof choice === "string" && !!choice.trim())
            .slice(0, LIMITS.maxChoices)
            .map((choice) => clip(choice, MAX_LABEL))
        : [];
    return {
        kind: "question",
        requestId,
        createdAt,
        question: clip(data.question, LIMITS.maxPromptDetailChars) || "Copilot asked a question.",
        choices,
        // With no choices, typing is the only way to answer.
        allowFreeform: data.allowFreeform === true || choices.length === 0,
    };
}
export function describePlan(requestId, createdAt, data) {
    const offered = Array.isArray(data.actions) ? data.actions : [];
    const actions = PLAN_ACTIONS.filter((action) => offered.includes(action));
    const prompt = {
        kind: "plan",
        requestId,
        createdAt,
        summary: clip(data.summary, MAX_INTENT * 2) || "The plan is ready for review.",
        plan: clip(data.planContent, LIMITS.maxPlanChars),
        actions,
    };
    const recommended = actions.find((action) => action === data.recommendedAction);
    if (recommended)
        prompt.recommended = recommended;
    return prompt;
}
