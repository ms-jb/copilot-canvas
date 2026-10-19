// Maps raw session events to the transcript's live activity: thinking blocks and tool calls.
// Everything that leaves here is summarized, redacted and truncated (see ACTIVITY_LIMITS).
import { ACTIVITY_LIMITS, pruneActivity } from "./contract/activity.mjs";
import { isPlainObject } from "./contract/validation.mjs";
import { upsertEntry } from "./entries.mjs";
/** Tools whose only job is reporting; their content shows elsewhere (the status intent). */
const HIDDEN_TOOLS = new Set(["report_intent"]);
const REDACTED = "[redacted]";
const SECRET_KEY = /pass(word|wd)?|secret|token|api[-_]?key|authorization|^auth$|credential|cookie|private[-_]?key|^env$/i;
const SECRET_PATTERNS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
    // NAME_TOKEN=value, export API_KEY=value, $env:SECRET="value"
    [
        /((?:\$env:|export\s+)?[A-Za-z_][A-Za-z0-9_]*(?:password|passwd|secret|token|api[-_]?key|credential|authorization)[A-Za-z0-9_]*["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        `$1${REDACTED}`,
    ],
    // password: value, "api_key": "value", token=value
    [
        /\b((?:password|secret|token|api[_ -]?key|client[_ -]?secret|authorization)["']?\s*[=:]\s*)(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        `$1${REDACTED}`,
    ],
    [
        /((?:^|\s)--?(?:password|secret|token|api[-_]?key|client[-_]?secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        `$1${REDACTED}`,
    ],
    [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
    [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, `$1${REDACTED}@`],
    [
        /\b(?:gh[oprsu]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g,
        REDACTED,
    ],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
];
// Long runs mixing upper case, lower case and digits look like keys; hashes and UUIDs don't.
const OPAQUE = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const looksSecret = (run) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run);
/** Masks values that look like credentials: KEY=value pairs, bearer tokens and known key shapes. */
export function redactSecrets(text) {
    let result = text;
    for (const [pattern, replacement] of SECRET_PATTERNS)
        result = result.replace(pattern, replacement);
    return result.replace(OPAQUE, (run) => (looksSecret(run) ? REDACTED : run));
}
/** Cuts `text` to `max` characters, ending in an ellipsis when it was longer. */
function clip(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
/** Redacts, then clips; input far beyond the limit is cut first so redaction stays cheap. */
function safe(text, max) {
    return clip(redactSecrets(text.length > max * 4 ? text.slice(0, max * 4) : text), max);
}
/** True for tools that only report (their content shows as the status intent instead). */
export const isHiddenTool = (name) => typeof name === "string" && HIDDEN_TOOLS.has(name);
/** Collapses whitespace, redacts and clips; undefined for anything but non-blank text. */
export function oneLine(value, max) {
    if (typeof value !== "string")
        return undefined;
    const text = safe(value.replace(/\s+/g, " ").trim(), max);
    return text || undefined;
}
function redactValue(value, depth = 0) {
    if (Array.isArray(value))
        return depth > 4 ? "[…]" : value.map((v) => redactValue(v, depth + 1));
    if (!isPlainObject(value))
        return value;
    if (depth > 4)
        return "{…}";
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED : redactValue(v, depth + 1),
    ]));
}
/** One `key: value` line per argument; strings stay raw so commands read naturally. */
export function summarizeArgs(args) {
    if (args === undefined || args === null)
        return undefined;
    const redacted = redactValue(args);
    const text = isPlainObject(redacted)
        ? Object.entries(redacted)
            .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
            .join("\n")
        : typeof redacted === "string"
            ? redacted
            : JSON.stringify(redacted);
    return text ? safe(text, ACTIVITY_LIMITS.maxArgsChars) : undefined;
}
function shortPath(path) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}
/** What a call is for: its description, else the path, command, URL host or query it targets. */
function describeCall(args) {
    if (!isPlainObject(args))
        return undefined;
    const max = ACTIVITY_LIMITS.maxDetailChars;
    const description = oneLine(args.description, max) ?? oneLine(args.intent, max);
    if (description)
        return description;
    for (const key of ["path", "filePath", "file_path"]) {
        if (typeof args[key] === "string")
            return oneLine(shortPath(args[key]), max);
    }
    for (const key of ["command", "cmd"]) {
        if (typeof args[key] === "string")
            return oneLine(args[key].split(/\r?\n/, 1)[0], max);
    }
    if (typeof args.url === "string") {
        try {
            return oneLine(new URL(args.url).host, max);
        }
        catch {
            return undefined;
        }
    }
    return oneLine(args.query, max) ?? oneLine(args.pattern, max) ?? oneLine(args.prompt, max);
}
function resultOf(data) {
    const raw = data.success === false
        ? (data.error?.message ?? data.error)
        : (data.result?.content ?? data.result?.detailedContent);
    return typeof raw === "string" && raw.trim()
        ? safe(raw.trim(), ACTIVITY_LIMITS.maxResultChars)
        : undefined;
}
function durationBetween(start, end) {
    const elapsed = Date.parse(end) - Date.parse(start);
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}
export function createActivityTracker() {
    let items = [];
    let since;
    // Raw thinking text by item id, kept one character past the cap to detect truncation.
    const rawReasoning = new Map();
    const find = (id) => items.find((item) => item.id === id);
    function put(item) {
        items = pruneActivity(upsertEntry(items, item, Number.POSITIVE_INFINITY), since);
        for (const id of rawReasoning.keys())
            if (!find(id))
                rawReasoning.delete(id);
        return item;
    }
    function reasoning(id, raw, timestamp, streaming) {
        const max = ACTIVITY_LIMITS.maxReasoningChars;
        const capped = raw.slice(0, max + 1);
        rawReasoning.set(id, capped);
        const item = {
            id,
            kind: "reasoning",
            text: clip(redactSecrets(capped), max),
            timestamp,
            streaming,
        };
        if (capped.length > max)
            item.truncated = true;
        return put(item);
    }
    function apply(event) {
        const data = event.data ?? {};
        switch (event.type) {
            case "assistant.reasoning_delta": {
                if (typeof data.reasoningId !== "string" || typeof data.deltaContent !== "string")
                    break;
                const id = `reasoning:${data.reasoningId}`;
                const existing = find(id);
                if (existing?.kind === "reasoning" && (existing.truncated || !existing.streaming))
                    break;
                const raw = (rawReasoning.get(id) ?? "") + data.deltaContent;
                return [reasoning(id, raw, existing?.timestamp ?? event.timestamp, true)];
            }
            case "assistant.reasoning": {
                if (typeof data.reasoningId !== "string")
                    break;
                const id = `reasoning:${data.reasoningId}`;
                const existing = find(id);
                const timestamp = existing?.timestamp ?? event.timestamp;
                if (typeof data.content === "string" && data.content.trim()) {
                    return [reasoning(id, data.content, timestamp, false)];
                }
                // Encrypted or empty thinking: keep whatever streamed, otherwise show nothing.
                if (existing?.kind === "reasoning" && existing.streaming) {
                    return [put({ ...existing, streaming: false })];
                }
                break;
            }
            case "tool.execution_start": {
                if (typeof data.toolCallId !== "string" || typeof data.toolName !== "string")
                    break;
                if (isHiddenTool(data.toolName))
                    break;
                const name = clip(data.toolName, ACTIVITY_LIMITS.maxNameChars);
                const item = {
                    id: `tool:${data.toolCallId}`,
                    kind: "tool",
                    name,
                    state: "running",
                    timestamp: event.timestamp,
                };
                const title = oneLine(data.toolTitle, ACTIVITY_LIMITS.maxNameChars);
                if (title && title !== name)
                    item.title = title;
                const detail = describeCall(data.arguments);
                if (detail)
                    item.detail = detail;
                const args = summarizeArgs(data.arguments);
                if (args)
                    item.args = args;
                return [put(item)];
            }
            case "tool.execution_progress": {
                const existing = find(`tool:${data.toolCallId}`);
                const progress = oneLine(data.progressMessage, ACTIVITY_LIMITS.maxProgressChars);
                if (existing?.kind !== "tool" || existing.state !== "running" || !progress)
                    break;
                if (existing.progress === progress)
                    break;
                return [put({ ...existing, progress })];
            }
            case "subagent.started": {
                const existing = find(`tool:${data.toolCallId}`);
                const title = oneLine(data.agentDisplayName, ACTIVITY_LIMITS.maxNameChars) ??
                    oneLine(data.agentName, ACTIVITY_LIMITS.maxNameChars);
                if (existing?.kind !== "tool" || !title)
                    break;
                return [put({ ...existing, title })];
            }
            case "tool.execution_complete": {
                const existing = find(`tool:${data.toolCallId}`);
                if (existing?.kind !== "tool")
                    break;
                const { progress: _progress, ...rest } = existing;
                const item = { ...rest, state: data.success === false ? "failed" : "succeeded" };
                const durationMs = durationBetween(existing.timestamp, event.timestamp);
                if (durationMs !== undefined)
                    item.durationMs = durationMs;
                const result = resultOf(data);
                if (result)
                    item.result = result;
                return [put(item)];
            }
            default:
                break;
        }
        return [];
    }
    return {
        apply,
        startTurn(timestamp) {
            since = timestamp;
            items = pruneActivity(items, since);
        },
        endTurn() {
            return items
                .filter((item) => item.kind === "reasoning" && item.streaming)
                .map((item) => put({ ...item, streaming: false }));
        },
        items: () => items.map((item) => ({ ...item })),
    };
}
