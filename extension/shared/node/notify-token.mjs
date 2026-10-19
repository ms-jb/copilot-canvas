// The local notify secret: 32 random bytes, base64url, in an owner-only file in the runtime folder.
// The gateway creates it at start; `npm run notify` reads it. Never log or serve it.
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { writePrivateFile } from "./runtime-state.mjs";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The token at `path`, or null when it is missing, malformed, not a regular file or not private. */
export function readNotifyToken(path) {
    try {
        const stat = lstatSync(path);
        if (!stat.isFile())
            return null;
        // Windows has no POSIX modes; the runtime folder's ACL is the boundary there.
        if (process.platform !== "win32") {
            if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
                return null;
        }
        const token = readFileSync(path, "utf8").trim();
        return TOKEN_PATTERN.test(token) ? token : null;
    }
    catch {
        return null;
    }
}
/** Keeps a valid private token, otherwise writes a fresh one. Delete the file to rotate it. */
export function ensureNotifyToken(path) {
    const existing = readNotifyToken(path);
    if (existing)
        return existing;
    const token = randomBytes(32).toString("base64url");
    writePrivateFile(path, `${token}\n`);
    return token;
}
