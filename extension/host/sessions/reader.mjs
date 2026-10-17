import { randomUUID } from "node:crypto";
import { APP_SESSION_ID, isSessionTime, MAX_SESSIONS, } from "../../shared/contract/sessions.mjs";
import { isPlainObject } from "../../shared/contract/validation.mjs";
import { readLocalSessionMetadata } from "./metadata.mjs";
const text = (value, max) => typeof value === "string"
    ? value
        .replace(/[\p{Cc}\p{Cf}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
        .trim()
    : "";
function activity(row) {
    const state = isPlainObject(row.activity) ? row.activity : {};
    const wait = state.waiting_on;
    if (row.awaiting_user_input === true ||
        row.awaiting_plan_approval === true ||
        isPlainObject(row.awaiting_input) ||
        isPlainObject(row.pending_plan) ||
        (typeof wait === "string" && wait !== "") ||
        isPlainObject(wait) ||
        state.status === "blocked")
        return "waiting";
    return state.status === "busy" || state.status === "idle" ? state.status : "unknown";
}
function fromApp(value, metadata, currentId) {
    if (!isPlainObject(value) ||
        !isPlainObject(value.summary) ||
        !Array.isArray(value.sessions) ||
        value.summary.total !== value.sessions.length ||
        value.sessions.length > 5000)
        return null;
    const local = new Map(metadata.map((row) => [row.id, row]));
    const rows = [];
    const seen = new Set();
    for (const row of value.sessions) {
        if (!isPlainObject(row) || typeof row.id !== "string" || !APP_SESSION_ID.test(row.id))
            return null;
        if (seen.has(row.id))
            return null;
        seen.add(row.id);
        if (row.is_running === false && row.id !== currentId)
            continue;
        rows.push({
            id: row.id,
            title: text(row.name, 160) || "Unnamed session",
            project: text(row.project_name, 80) || text(local.get(row.id)?.project, 80) || null,
            state: activity(row),
            updatedAt: isSessionTime(row.updated_at)
                ? row.updated_at
                : (local.get(row.id)?.updatedAt ?? null),
            current: row.id === currentId,
            canOpen: true,
        });
    }
    return rows;
}
function newest(rows) {
    const sorted = rows.sort((a, b) => (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0) ||
        a.id.localeCompare(b.id));
    const current = sorted.find((row) => row.current);
    const selected = sorted.slice(0, MAX_SESSIONS);
    if (current && !selected.includes(current))
        selected[MAX_SESSIONS - 1] = current;
    return selected;
}
/**
 * Prefer the joined SDK's single read-only app tool. The server-scoped sessions.list RPC is not
 * exposed by joinSession. Saved-file tool results are deliberately not followed.
 */
export function createSessionsReader({ session, sessionId, currentState, readMetadata = () => readLocalSessionMetadata(undefined, sessionId), now = Date.now, timeoutMs = 5000, }) {
    let cached;
    let readAt = 0;
    let pending;
    let appDisabled = false;
    async function readApp() {
        const tools = session?.rpc?.tools;
        if (!session || !tools?.execute || appDisabled)
            return null;
        const toolCallId = `canvas-sessions-${randomUUID()}`;
        let timer;
        const off = session.on((event) => {
            // Permission payload text is never inspected; stop unattended retries on any new request.
            if (event.type.startsWith("permission."))
                appDisabled = true;
        });
        try {
            const result = await Promise.race([
                tools.execute({ name: "get_sessions_status", arguments: {}, toolCallId }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error("Session read timed out.")), timeoutMs);
                }),
            ]);
            const raw = typeof result === "string"
                ? result
                : isPlainObject(result) && result.resultType === "success"
                    ? result.textResultForLlm
                    : null;
            if (typeof raw !== "string" || Buffer.byteLength(raw) > 1024 * 1024) {
                appDisabled = true;
                return null;
            }
            return JSON.parse(raw);
        }
        catch {
            // Never repeat a timed-out/permission-blocked invocation or read the runtime's saved file.
            appDisabled = true;
            return null;
        }
        finally {
            clearTimeout(timer);
            off();
        }
    }
    async function read() {
        const [app, local] = await Promise.all([readApp(), readMetadata().catch(() => null)]);
        const appRows = fromApp(app, local ?? [], sessionId);
        const source = appRows !== null ? "app" : local !== null ? "local" : "unavailable";
        const rows = appRows ??
            (local ?? []).map((row) => ({
                id: row.id,
                title: text(row.name, 160) || text(row.summary, 160) || "Unnamed session",
                project: text(row.project, 80) || null,
                state: row.id === sessionId ? currentState() : "unknown",
                updatedAt: row.updatedAt,
                current: row.id === sessionId,
                canOpen: false,
            }));
        return { sessionId, source, checkedAt: new Date(now()).toISOString(), sessions: newest(rows) };
    }
    return () => {
        if (cached && now() - readAt < 25_000)
            return Promise.resolve(cached);
        pending ??= read()
            .then((value) => {
            cached = value;
            readAt = now();
            return value;
        })
            .finally(() => {
            pending = undefined;
        });
        return pending;
    };
}
