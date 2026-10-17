// Host prompt service: the requests the session is waiting on (tool permissions, ask_user
// questions, elicitation forms and plan approvals), mirrored for the canvas and answered only with
// the user's explicit decision.
//
// - The session is the authority. Pending requests come from its own *.requested / *.completed
//   events; permission requests that were already pending (or that were missed while the provider
//   was away) are read back through `rpc.permissions.pendingRequests()`.
// - Every answer goes through the supported `rpc` call with the exact request id. Nothing here
//   approves on its own: there is no default decision, no timer, no "allow for session" scope and no
//   permission-mode change. A permission is approved once, and only when the user said so.
// - Each kind is offered only when its native function exists; otherwise the request is not listed
//   and the renderer keeps its plain "waiting" line.
// - One answer per request at a time (synchronous guard). A call that does not settle in time is
//   reported as "uncertain" and the request stays listed until the session confirms either way.
import { ERROR_CODES, LIMITS, PLAN_ACTIONS, SEND_STATUS } from "../shared/contract.mjs";
const MAX_SETTLED = 500;
const MAX_SUBJECT = 120;
const MAX_INTENT = 600;
const MAX_LABEL = 200;
const MAX_ERROR_MESSAGE = 300;
const DEFAULT_REFRESH_INTERVAL_MS = 1000;
const RESOLVED_MESSAGE = "This request was already answered or is no longer waiting.";
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function clip(value, size) {
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
const optional = (value, size) => {
    const text = clip(value, size).trim();
    return text ? text : undefined;
};
const lines = (...parts) => parts.filter((part) => typeof part === "string" && part.length > 0).join("\n");
function describeError(error) {
    const message = error instanceof Error ? error.message : "";
    return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE);
}
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
function describeQuestion(requestId, createdAt, data) {
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
const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** Maps one flat schema property to a field; null when the canvas can't render it. */
function describeField(name, schema, required) {
    if (!isRecord(schema))
        return null;
    const label = clip(schema.title, MAX_LABEL) || clip(name, MAX_LABEL);
    const field = { name, label, type: "string", required };
    const description = optional(schema.description, MAX_INTENT);
    if (description)
        field.description = description;
    switch (schema.type) {
        case "boolean":
            field.type = "boolean";
            if (typeof schema.default === "boolean")
                field.default = schema.default;
            return field;
        case "number":
        case "integer":
            field.type = schema.type;
            if (finite(schema.minimum) !== undefined)
                field.minimum = schema.minimum;
            if (finite(schema.maximum) !== undefined)
                field.maximum = schema.maximum;
            if (finite(schema.default) !== undefined)
                field.default = schema.default;
            return field;
        case "string": {
            let options;
            if (Array.isArray(schema.enum)) {
                if (!schema.enum.every((value) => typeof value === "string"))
                    return null;
                const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
                options = schema.enum.map((value, index) => ({
                    value,
                    label: clip(typeof names[index] === "string" ? names[index] : value, MAX_LABEL),
                }));
            }
            else if (Array.isArray(schema.oneOf)) {
                if (!schema.oneOf.every((o) => isRecord(o) && typeof o.const === "string")) {
                    return null;
                }
                options = schema.oneOf.map((o) => ({
                    value: o.const,
                    label: clip(typeof o.title === "string" ? o.title : o.const, MAX_LABEL),
                }));
            }
            if (options) {
                if (options.length === 0 || options.length > LIMITS.maxChoices)
                    return null;
                field.type = "enum";
                field.options = options;
                if (typeof schema.default === "string" && options.some((o) => o.value === schema.default)) {
                    field.default = schema.default;
                }
                return field;
            }
            if (finite(schema.minLength) !== undefined)
                field.minLength = schema.minLength;
            if (finite(schema.maxLength) !== undefined)
                field.maxLength = schema.maxLength;
            if (typeof schema.default === "string")
                field.default = clip(schema.default, MAX_INTENT);
            return field;
        }
        default:
            return null;
    }
}
function describeForm(requestId, createdAt, data) {
    const prompt = {
        kind: "form",
        requestId,
        createdAt,
        message: clip(data.message, LIMITS.maxPromptDetailChars) || "Copilot needs some details.",
        fields: [],
        supported: true,
    };
    const source = optional(data.elicitationSource, MAX_SUBJECT);
    if (source)
        prompt.source = source;
    if (data.mode === "url")
        return { ...prompt, supported: false };
    const schema = data.requestedSchema;
    if (schema === undefined)
        return prompt;
    if (!isRecord(schema) || !isRecord(schema.properties))
        return { ...prompt, supported: false };
    const required = new Set(Array.isArray(schema.required)
        ? schema.required.filter((n) => typeof n === "string")
        : []);
    const names = Object.keys(schema.properties);
    if (names.length > LIMITS.maxFormFields)
        return { ...prompt, supported: false };
    const fields = [];
    for (const name of names) {
        const field = describeField(name, schema.properties[name], required.has(name));
        if (!field)
            return { ...prompt, supported: false };
        fields.push(field);
    }
    return { ...prompt, fields };
}
function describePlan(requestId, createdAt, data) {
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
/** Checks one form submission against the prompt's fields and returns the values to send. */
function checkFormValues(prompt, values = {}) {
    const byName = new Map(prompt.fields.map((field) => [field.name, field]));
    const content = {};
    for (const name of Object.keys(values)) {
        if (!byName.has(name))
            return "The answer has a field this request doesn't ask for.";
    }
    for (const field of prompt.fields) {
        const value = Object.prototype.hasOwnProperty.call(values, field.name)
            ? values[field.name]
            : undefined;
        const empty = value === undefined || (typeof value === "string" && value.trim() === "");
        if (empty) {
            if (field.required)
                return `${field.label} is required.`;
            continue;
        }
        switch (field.type) {
            case "boolean":
                if (typeof value !== "boolean")
                    return `${field.label} must be yes or no.`;
                break;
            case "number":
            case "integer":
                if (typeof value !== "number" || (field.type === "integer" && !Number.isInteger(value))) {
                    return `${field.label} must be ${field.type === "integer" ? "a whole number" : "a number"}.`;
                }
                if (field.minimum !== undefined && value < field.minimum) {
                    return `${field.label} must be at least ${field.minimum}.`;
                }
                if (field.maximum !== undefined && value > field.maximum) {
                    return `${field.label} must be at most ${field.maximum}.`;
                }
                break;
            case "enum":
                if (typeof value !== "string" || !field.options?.some((o) => o.value === value)) {
                    return `${field.label} must be one of the listed options.`;
                }
                break;
            default:
                if (typeof value !== "string")
                    return `${field.label} must be text.`;
                if (field.minLength !== undefined && value.length < field.minLength) {
                    return `${field.label} is too short.`;
                }
                if (field.maxLength !== undefined && value.length > field.maxLength) {
                    return `${field.label} is too long.`;
                }
        }
        Object.defineProperty(content, field.name, { value, enumerable: true, writable: true });
    }
    return content;
}
export function createPromptService(session, { log = () => { }, timeoutMs = LIMITS.respondTimeoutMs, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS, } = {}) {
    const pending = new Map();
    const settled = new Set();
    const answering = new Set();
    const listeners = new Set();
    const cancels = new Set();
    let mark = 0;
    let disposed = false;
    let refreshing = false;
    let refreshQueued = false;
    let lastRefreshAt = 0;
    let refreshTimer = null;
    // Looked up on every use: the rpc surface is experimental and may change shape at runtime.
    const permissions = () => session.rpc?.permissions;
    const ui = () => session.rpc?.ui;
    const can = {
        permission: () => typeof permissions()?.handlePendingPermissionRequest === "function",
        list: () => typeof permissions()?.pendingRequests === "function",
        question: () => typeof ui()?.handlePendingUserInput === "function",
        form: () => typeof ui()?.handlePendingElicitation === "function",
        plan: () => typeof ui()?.handlePendingExitPlanMode === "function",
    };
    function list() {
        return [...pending.values()]
            .slice(-LIMITS.maxPrompts)
            .map((tracked) => structuredClone(tracked.prompt));
    }
    function notify() {
        if (disposed)
            return;
        const prompts = list();
        for (const listener of Array.from(listeners)) {
            try {
                listener(prompts);
            }
            catch (error) {
                log(`Prompt listener failed: ${describeError(error)}`, "warning");
            }
        }
    }
    function settle(requestId) {
        settled.add(requestId);
        if (settled.size > MAX_SETTLED)
            settled.delete(settled.values().next().value);
    }
    function add(prompt) {
        if (disposed || settled.has(prompt.requestId))
            return;
        const existing = pending.get(prompt.requestId);
        mark += 1;
        pending.set(prompt.requestId, { prompt, mark: existing?.mark ?? mark });
        notify();
    }
    function drop(requestId) {
        settle(requestId);
        if (pending.delete(requestId))
            notify();
    }
    function dropWhere(test) {
        let changed = false;
        for (const [requestId, tracked] of pending) {
            if (!test(tracked.prompt))
                continue;
            settle(requestId);
            pending.delete(requestId);
            changed = true;
        }
        if (changed)
            notify();
    }
    function applyEvent(event) {
        if (disposed || !event || typeof event.type !== "string")
            return;
        const data = isRecord(event.data) ? event.data : {};
        const requestId = typeof data.requestId === "string" && data.requestId.length > 0 ? data.requestId : null;
        const createdAt = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
        switch (event.type) {
            case "permission.requested":
                if (!requestId || !can.permission())
                    return;
                // Already decided by a hook: nothing to ask.
                if (data.resolvedByHook === true)
                    return settle(requestId);
                return add(describePermission(requestId, createdAt, data.promptRequest ?? data.permissionRequest));
            case "user_input.requested":
                if (requestId && can.question())
                    add(describeQuestion(requestId, createdAt, data));
                return;
            case "elicitation.requested":
                if (requestId && can.form())
                    add(describeForm(requestId, createdAt, data));
                return;
            case "exit_plan_mode.requested":
                if (requestId && can.plan())
                    add(describePlan(requestId, createdAt, data));
                return;
            case "permission.completed":
            case "user_input.completed":
            case "elicitation.completed":
            case "exit_plan_mode.completed":
                if (requestId)
                    drop(requestId);
                return;
            case "session.shutdown":
                if (!event.agentId)
                    dropWhere(() => true);
                return;
            case "session.idle":
            case "abort":
                // A finished turn can't still be asking; permissions are re-checked against the session.
                if (event.agentId)
                    return;
                dropWhere((prompt) => prompt.kind !== "permission");
                refresh();
                return;
            default:
                return;
        }
    }
    async function readPending() {
        const reader = permissions()?.pendingRequests;
        if (typeof reader !== "function" || !can.permission())
            return;
        const startMark = mark;
        let result;
        try {
            result = await reader.call(permissions());
        }
        catch (error) {
            log(`Could not read pending permission requests: ${describeError(error)}`, "warning");
            return;
        }
        if (disposed)
            return;
        const items = isRecord(result) && Array.isArray(result.items) ? result.items : [];
        const live = new Set();
        let changed = false;
        for (const item of items) {
            if (!isRecord(item) || typeof item.requestId !== "string" || !item.requestId)
                continue;
            live.add(item.requestId);
            if (pending.has(item.requestId) || settled.has(item.requestId))
                continue;
            mark += 1;
            const prompt = describePermission(item.requestId, new Date().toISOString(), item.request);
            pending.set(item.requestId, { prompt, mark });
            changed = true;
        }
        // Permissions we knew before this read started that the session no longer lists were resolved
        // elsewhere. Anything that arrived during the read is kept; an answer in flight is kept.
        for (const [requestId, tracked] of pending) {
            if (tracked.prompt.kind !== "permission" || tracked.mark > startMark)
                continue;
            if (live.has(requestId) || answering.has(requestId))
                continue;
            settle(requestId);
            pending.delete(requestId);
            changed = true;
        }
        if (changed)
            notify();
    }
    function refresh() {
        if (disposed || !can.list())
            return;
        if (refreshing) {
            refreshQueued = true;
            return;
        }
        const wait = lastRefreshAt + refreshIntervalMs - Date.now();
        if (wait > 0) {
            if (refreshTimer === null) {
                refreshTimer = setTimeout(() => {
                    refreshTimer = null;
                    refresh();
                }, wait);
            }
            return;
        }
        refreshing = true;
        lastRefreshAt = Date.now();
        void runRefresh();
    }
    async function runRefresh() {
        try {
            await readPending();
        }
        finally {
            refreshing = false;
            if (refreshQueued && !disposed) {
                refreshQueued = false;
                refresh();
            }
        }
    }
    const rejected = (code, message) => ({
        ok: false,
        status: SEND_STATUS.rejected,
        code,
        message,
    });
    /** Builds the native call for one answer, or a rejection when it doesn't fit the prompt. */
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
    async function respond(requestId, response) {
        if (disposed) {
            return rejected(ERROR_CODES.notConnected, "The session is no longer connected.");
        }
        const tracked = pending.get(requestId);
        if (!tracked)
            return rejected(ERROR_CODES.promptResolved, RESOLVED_MESSAGE);
        // Recorded before any await so a double tap or a second client can never answer twice.
        if (answering.has(requestId)) {
            return rejected(ERROR_CODES.duplicateRequest, "This request is already being answered.");
        }
        const call = prepare(tracked.prompt, response);
        if (typeof call !== "function")
            return call;
        answering.add(requestId);
        const attempt = Promise.resolve()
            .then(call)
            .then((result) => ({ result }), (error) => ({ error }));
        // Whatever the timing, the request stays guarded until the native call settles.
        const finished = attempt.then((outcome) => {
            answering.delete(requestId);
            if ("error" in outcome)
                return outcome;
            // success:false means the session no longer has it waiting (answered elsewhere, expired).
            drop(requestId);
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
    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        if (refreshTimer !== null)
            clearTimeout(refreshTimer);
        for (const cancel of Array.from(cancels))
            cancel();
        cancels.clear();
        pending.clear();
        listeners.clear();
    }
    let ready = Promise.resolve();
    if (can.list()) {
        refreshing = true;
        lastRefreshAt = Date.now();
        ready = runRefresh();
    }
    return { ready, list, subscribe, applyEvent, refresh, respond, dispose };
}
