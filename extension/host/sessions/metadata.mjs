import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_SESSION_ID, isSessionTime } from "../../shared/contract/sessions.mjs";
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_DIRECTORIES = 50_000;
const MAX_METADATA_READS = 200;
const FIELDS = new Set(["id", "name", "summary", "repository", "cwd", "git_root", "updated_at"]);
/** Reads only single-line display fields, not YAML objects, aliases or multiline content. */
export function parseSessionMetadata(text, id) {
    if (!APP_SESSION_ID.test(id) || Buffer.byteLength(text) > MAX_METADATA_BYTES)
        return null;
    const fields = {};
    for (const line of text.split(/\r?\n/)) {
        const match = /^([a-z_]+): (.*)$/.exec(line);
        if (!match || !FIELDS.has(match[1]))
            continue;
        let value = match[2].trim();
        if (/^[|>&*!{[]/.test(value))
            continue;
        if (value.startsWith('"')) {
            try {
                const parsed = JSON.parse(value);
                if (typeof parsed !== "string")
                    continue;
                value = parsed;
            }
            catch {
                continue;
            }
        }
        else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1).replaceAll("''", "'");
        }
        fields[match[1]] = value;
    }
    if (fields.id !== id)
        return null;
    const folder = (fields.git_root ?? fields.cwd)
        ?.replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .at(-1);
    return {
        id,
        name: fields.name,
        summary: fields.summary,
        project: fields.repository || folder,
        updatedAt: isSessionTime(fields.updated_at) ? fields.updated_at : null,
    };
}
/** Never opens events, databases, checkpoints, locks, tokens or arbitrary paths from metadata. */
export async function readLocalSessionMetadata(root = join(homedir(), ".copilot", "session-state"), currentId) {
    const base = await realpath(root);
    const directories = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && APP_SESSION_ID.test(entry.name));
    if (directories.length > MAX_DIRECTORIES)
        throw new Error("Session inventory too large.");
    // Rank by the metadata file's modification time before reading any contents. Large historical
    // inventories therefore still read at most 200 metadata files, plus the bound session.
    const candidates = [];
    let cursor = 0;
    const deadline = Date.now() + 6000;
    await Promise.all(Array.from({ length: 32 }, async () => {
        while (cursor < directories.length) {
            if (Date.now() > deadline)
                throw new Error("Session metadata scan timed out.");
            const id = directories[cursor++].name;
            try {
                const metadata = await stat(join(base, id, "workspace.yaml"));
                if (metadata.isFile() && metadata.size <= MAX_METADATA_BYTES)
                    candidates.push({ id, time: metadata.mtimeMs });
            }
            catch {
                // A disappearing or incomplete session has no display metadata.
            }
        }
    }));
    const selected = candidates
        .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
        .slice(0, MAX_METADATA_READS);
    if (currentId &&
        APP_SESSION_ID.test(currentId) &&
        !selected.some((row) => row.id === currentId)) {
        selected.push({ id: currentId, time: 0 });
    }
    const rows = [];
    let index = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (index < selected.length) {
            if (Date.now() > deadline)
                throw new Error("Session metadata read timed out.");
            const id = selected[index++].id;
            const directory = join(base, id);
            try {
                const path = join(directory, "workspace.yaml");
                if ((await realpath(directory)) !== directory || (await realpath(path)) !== path)
                    continue;
                const file = await open(path, "r");
                try {
                    const stat = await file.stat();
                    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES || dirname(path) !== directory)
                        continue;
                    const bytes = Buffer.alloc(MAX_METADATA_BYTES + 1);
                    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
                    if (bytesRead > MAX_METADATA_BYTES)
                        continue;
                    const row = parseSessionMetadata(bytes.toString("utf8", 0, bytesRead), id);
                    if (row)
                        rows.push(row);
                }
                finally {
                    await file.close();
                }
            }
            catch {
                // A session can disappear while the inventory is read.
            }
        }
    }));
    return rows;
}
