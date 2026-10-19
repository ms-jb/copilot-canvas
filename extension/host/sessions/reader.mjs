import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";
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
const MAX_STATUS_BYTES = 8 * 1024 * 1024;
const SAVED_OUTPUT = /^Output too large to read at once \([^)\r\n]*\)\. Saved to: ([^\r\n]+)\r?\n/;
const SAVED_NAME = /^\d{1,20}-copilot-tool-output-[0-9a-f]{32}\.txt$/;
/**
 * Large tool results come back as a pointer to a file the runtime saved for this invocation. Only
 * a runtime-named regular file directly in the temp folder is read, once, and only that same file
 * (by identity, not just by name) is then removed.
 */
export async function readSavedOutput(raw, tempDir = tmpdir()) {
    const path = SAVED_OUTPUT.exec(raw)?.[1].trim();
    if (!path || !isAbsolute(path) || !SAVED_NAME.test(basename(path)))
        return null;
    let real;
    let entry;
    try {
        const [file, root] = await Promise.all([realpath(path), realpath(tempDir)]);
        if (dirname(file) !== root || !SAVED_NAME.test(basename(file)))
            return null;
        entry = await lstat(file, { bigint: true });
        if (!entry.isFile())
            return null;
        real = file;
    }
    catch {
        return null;
    }
    try {
        const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const opened = await handle.stat({ bigint: true });
            if (!opened.isFile() || !sameFile(opened, entry) || opened.size > MAX_STATUS_BYTES)
                return null;
            // readFile reads to EOF, so a short read never returns a truncated document.
            const content = await handle.readFile();
            return content.length > MAX_STATUS_BYTES ? null : content.toString("utf8");
        }
        finally {
            await handle.close();
        }
    }
    catch {
        return null;
    }
    finally {
        try {
            if (sameFile(await lstat(real, { bigint: true }), entry))
                await unlink(real);
        }
        catch {
            // Already gone, or replaced by another file that is not ours to remove.
        }
    }
}
function sameFile(a, b) {
    return a.dev === b.dev && a.ino === b.ino;
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
        const project = text(row.project_name, 80) ||
            text(row.project_repo, 80) ||
            text(local.get(row.id)?.project, 80) ||
            null;
        rows.push({
            id: row.id,
            title: text(row.name, 160) || (project ? `Session in ${project}` : "Untitled session"),
            project,
            state: activity(row),
            updatedAt: isSessionTime(row.updated_at)
                ? row.updated_at
                : (local.get(row.id)?.updatedAt ?? null),
            current: row.id === currentId,
            canOpen: true,
            running: row.id === currentId || row.is_running !== false,
        });
    }
    return rows;
}
/**
 * Keeps the current session and running sessions first, then the most recent. The app already
 * lists newest first; `ordered` keeps that order instead of re-sorting by partial local times.
 */
function newest(rows, ordered = false) {
    const sorted = ordered
        ? rows
        : rows.sort((a, b) => (b.updatedAt ? Date.parse(b.updatedAt) : 0) -
            (a.updatedAt ? Date.parse(a.updatedAt) : 0) || a.id.localeCompare(b.id));
    const first = (row) => row.current || row.running === true;
    // The current session is reserved first so 30 running sessions can never push it out.
    const kept = new Set([
        ...sorted.filter((row) => row.current),
        ...sorted.filter((row) => !row.current && first(row)),
        ...sorted.filter((row) => !first(row)),
    ].slice(0, MAX_SESSIONS));
    return sorted
        .filter((row) => kept.has(row))
        .map(({ running: _running, ...row }) => row);
}
/**
 * Prefer the joined SDK's single read-only app tool. The server-scoped sessions.list RPC is not
 * exposed by joinSession. A large result is read from the runtime's saved file only when that file
 * passes readSavedOutput's checks.
 */
export function createSessionsReader({ session, sessionId, currentState, readMetadata = () => readLocalSessionMetadata(undefined, sessionId), now = Date.now, timeoutMs = 60_000, waitMs = 3000, }) {
    let cached;
    let readAt = 0;
    let pending;
    let appDisabled = false;
    let appRead;
    let lastApp = null;
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
            const saved = raw.trimStart().startsWith("{") ? null : await readSavedOutput(raw);
            return JSON.parse(saved ?? raw);
        }
        catch {
            // Never repeat a timed-out or permission-blocked invocation.
            appDisabled = true;
            return null;
        }
        finally {
            clearTimeout(timer);
            off();
        }
    }
    async function read() {
        // The app's list can take many seconds; until the first one arrives, show local rows.
        appRead ??= readApp().then((value) => {
            if (value !== null) {
                lastApp = value;
                readAt = 0; // The next poll shows the app's list instead of cached local rows.
            }
            appRead = undefined;
        });
        let waited;
        const [, local] = await Promise.all([
            Promise.race([appRead, new Promise((resolve) => (waited = setTimeout(resolve, waitMs)))]),
            readMetadata().catch(() => null),
        ]);
        clearTimeout(waited);
        const appRows = fromApp(lastApp, local ?? [], sessionId);
        const checkedAt = new Date(now()).toISOString();
        if (appRows !== null)
            return { sessionId, source: "app", checkedAt, sessions: newest(appRows, true) };
        if (local === null)
            return { sessionId, source: "unavailable", checkedAt, sessions: [] };
        const rows = local.map((row) => {
            const project = text(row.project, 80) || null;
            return {
                id: row.id,
                title: text(row.name, 160) ||
                    text(row.summary, 160) ||
                    (project ? `Session in ${project}` : "Untitled session"),
                project,
                state: row.id === sessionId ? currentState() : "unknown",
                updatedAt: row.updatedAt,
                current: row.id === sessionId,
                canOpen: false,
            };
        });
        return { sessionId, source: "local", checkedAt, sessions: newest(rows) };
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
