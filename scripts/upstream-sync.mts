// Brings upstream changes from the Copilot Companion template (Copilot Canvas) into a user's copy.
//
//   node scripts/upstream-sync.mts check  [--json] [--notify] [--upstream <url>] [--branch main]
//   node scripts/upstream-sync.mts apply  [--json] [--name <branch>]
//   node scripts/upstream-sync.mts record [--sha <commit>]
//   node scripts/upstream-sync.mts guess  [--json]
//
// A copy made from the template shares no history with it, so `git merge` would see every file as
// added on both sides. Instead `.template-sync.json` records the upstream commit the copy was last
// synced to, and each file upstream changed since is classified against that base:
//   untouched      the copy still has upstream's old version: take the new one
//   changed-by-you the copy edited it: three-way merge (base = old upstream, yours, new upstream)
//   protected      personalization (template.config.json, branding): never overwritten
//   generated      the built `extension/`: rebuilt, never merged
// `check` only reads (apart from adding the fetch-only `upstream` remote); `--notify` also pushes a
// notice to the phone when there is news, for a scheduled check. `apply` works on a new branch,
// never on the current one, and never discards the copy's edits: a conflict leaves markers for a
// person to resolve. Exit codes: 0 up to date (or applied), 10 `check` found updates, 1 error.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const UPSTREAM_URL = "https://github.com/ms-jb/copilot-companion.git";
export const SYNC_FILE = ".template-sync.json";
const REMOTE = "upstream";
const WORK_DIR = ".runtime/upstream-sync";

/** Files a person made their own: upstream never overwrites them. */
const PROTECTED_FILES = new Set(["template.config.json", SYNC_FILE]);
const PROTECTED_DIRS = ["ui/public/assets/", ".runtime/"];
/** Built or installed output: rebuilt with `npm run build` / `npm install`, never merged. */
const GENERATED_FILES = new Set(["package-lock.json"]);
const GENERATED_DIRS = ["extension/"];

export type Kind = "untouched" | "changed-by-you" | "protected" | "generated" | "already-applied";
export type Change = "added" | "modified" | "deleted";

export interface FileReport {
  path: string;
  upstream: Change;
  kind: Kind;
  /** What `apply` does with it. */
  action: "add" | "update" | "delete" | "merge" | "skip";
  note?: string;
}

export interface CommitReport {
  sha: string;
  subject: string;
  areas: string[];
}

export interface SyncState {
  upstream: string;
  branch: string;
  sha: string;
  syncedAt: string;
}

export interface CheckReport {
  state: "up-to-date" | "updates" | "unknown-base";
  base: string | null;
  head: string;
  commits: CommitReport[];
  files: FileReport[];
  /** gateway/ or src/shared/ changed: the phone gateway keeps old code until it is restarted. */
  restartGateway: boolean;
  /** Anything but documentation changed: the canvas needs a rebuild and Reload extensions. */
  rebuild: boolean;
  /** package.json changed: run `npm install`. */
  install: boolean;
}

export interface Git {
  (
    args: string[],
    options?: { input?: Buffer | string; allowFail?: boolean },
  ): {
    code: number;
    stdout: Buffer;
    stderr: string;
  };
}

export function createGit(cwd: string): Git {
  return (args, { input, allowFail = false } = {}) => {
    const result = spawnSync("git", args, {
      cwd,
      input,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const code = result.status ?? 1;
    const stderr = result.stderr?.toString() ?? "";
    if (code !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
    return { code, stdout: result.stdout ?? Buffer.alloc(0), stderr };
  };
}

const text = (git: Git, args: string[]) => git(args).stdout.toString().trim();

export function classifyPath(path: string): "protected" | "generated" | null {
  if (PROTECTED_FILES.has(path) || PROTECTED_DIRS.some((dir) => path.startsWith(dir))) {
    return "protected";
  }
  if (GENERATED_FILES.has(path) || GENERATED_DIRS.some((dir) => path.startsWith(dir))) {
    return "generated";
  }
  return null;
}

export function areaOf(path: string): string {
  if (path.startsWith("ui/")) return "ui";
  if (path.startsWith("gateway/")) return "gateway";
  if (path.startsWith("src/host/")) return "host";
  if (path.startsWith("src/shared/")) return "shared";
  if (path.startsWith("tests/")) return "tests";
  if (path.startsWith("scripts/")) return "scripts";
  if (path.startsWith(".github/")) return "skills";
  if (path.endsWith(".md") || path.startsWith("docs/")) return "docs";
  if (path.startsWith("extension/")) return "build";
  return "other";
}

export function readState(root: string): SyncState | null {
  try {
    const value = JSON.parse(readFileSync(join(root, SYNC_FILE), "utf8")) as Partial<SyncState>;
    if (typeof value.sha !== "string" || !/^[0-9a-f]{40}$/.test(value.sha)) return null;
    return {
      upstream: typeof value.upstream === "string" ? value.upstream : UPSTREAM_URL,
      branch: typeof value.branch === "string" ? value.branch : "main",
      sha: value.sha,
      syncedAt: typeof value.syncedAt === "string" ? value.syncedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeState(root: string, state: SyncState): void {
  writeFileSync(join(root, SYNC_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

/** Adds the fetch-only `upstream` remote (push disabled) when it is missing, then fetches it. */
export function fetchUpstream(git: Git, url: string, branch: string): string {
  const remotes = text(git, ["remote"]).split("\n");
  if (!remotes.includes(REMOTE)) {
    git(["remote", "add", REMOTE, url]);
    // This copy only ever reads from the template.
    git(["remote", "set-url", "--push", REMOTE, "DISABLED"]);
  }
  git(["fetch", "--no-tags", "--quiet", REMOTE, branch]);
  return text(git, ["rev-parse", `${REMOTE}/${branch}^{commit}`]);
}

const blobAt = (git: Git, commit: string, path: string): Buffer | null => {
  const result = git(["show", `${commit}:${path}`], { allowFail: true });
  return result.code === 0 ? result.stdout : null;
};

function readLocal(root: string, path: string): Buffer | null {
  try {
    return readFileSync(join(root, path));
  } catch {
    return null;
  }
}

const same = (a: Buffer | null, b: Buffer | null) =>
  a === null || b === null ? a === b : a.equals(b);

/** The files upstream changed between two commits, with how. */
export function changedFiles(
  git: Git,
  base: string,
  head: string,
): { path: string; change: Change }[] {
  const out = git(["diff", "--no-renames", "--name-status", "-z", base, head]).stdout.toString();
  const parts = out.split("\0").filter(Boolean);
  const files: { path: string; change: Change }[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const status = parts[index]![0];
    const path = parts[index + 1]!;
    files.push({
      path,
      change: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
    });
  }
  return files;
}

export function classify(
  git: Git,
  root: string,
  base: string,
  head: string,
  file: { path: string; change: Change },
): FileReport {
  const { path, change } = file;
  const fixed = classifyPath(path);
  const mine = readLocal(root, path);
  const theirs = blobAt(git, head, path);
  const old = blobAt(git, base, path);
  if (fixed === "generated") {
    return { path, upstream: change, kind: "generated", action: "skip", note: "rebuilt" };
  }
  if (fixed === "protected") {
    // A file the copy lacks may still arrive; one it has is never touched.
    return mine === null && change === "added" && theirs
      ? { path, upstream: change, kind: "protected", action: "add" }
      : { path, upstream: change, kind: "protected", action: "skip", note: "personalization" };
  }
  if (change === "deleted") {
    if (mine === null) {
      return { path, upstream: change, kind: "already-applied", action: "skip" };
    }
    return same(mine, old)
      ? { path, upstream: change, kind: "untouched", action: "delete" }
      : {
          path,
          upstream: change,
          kind: "changed-by-you",
          action: "skip",
          note: "upstream removed it, but you changed it: kept",
        };
  }
  if (same(mine, theirs))
    return { path, upstream: change, kind: "already-applied", action: "skip" };
  if (mine === null) {
    return change === "added"
      ? { path, upstream: change, kind: "untouched", action: "add" }
      : {
          path,
          upstream: change,
          kind: "changed-by-you",
          action: "skip",
          note: "you deleted it: left deleted",
        };
  }
  if (change === "modified" && same(mine, old)) {
    return { path, upstream: change, kind: "untouched", action: "update" };
  }
  return {
    path,
    upstream: change,
    kind: "changed-by-you",
    action: "merge",
    ...(change === "added" ? { note: "both sides added it" } : {}),
  };
}

function commitsBetween(git: Git, base: string, head: string): CommitReport[] {
  const listed = text(git, [
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H\t%s",
    `${base}..${head}`,
  ]);
  return listed
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", ...subject] = line.split("\t");
      const files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha])
        .stdout.toString()
        .split("\0")
        .filter(Boolean);
      const areas = [...new Set(files.map(areaOf))].filter((area) => area !== "build");
      return { sha, subject: subject.join("\t"), areas };
    });
}

export interface CheckOptions {
  root: string;
  git?: Git;
  url?: string;
  branch?: string;
  /** Use this base instead of `.template-sync.json`. */
  base?: string;
  fetch?: boolean;
}

export function check(options: CheckOptions): CheckReport {
  const { root } = options;
  const git = options.git ?? createGit(root);
  const state = readState(root);
  const url = options.url ?? state?.upstream ?? UPSTREAM_URL;
  const branch = options.branch ?? state?.branch ?? "main";
  const head =
    options.fetch === false
      ? text(git, ["rev-parse", `${REMOTE}/${branch}^{commit}`])
      : fetchUpstream(git, url, branch);
  const base = options.base ?? state?.sha ?? null;
  const known =
    base !== null && git(["cat-file", "-e", `${base}^{commit}`], { allowFail: true }).code === 0;
  if (!base || !known) {
    return {
      state: "unknown-base",
      base,
      head,
      commits: [],
      files: [],
      restartGateway: false,
      rebuild: false,
      install: false,
    };
  }
  if (base === head) {
    return {
      state: "up-to-date",
      base,
      head,
      commits: [],
      files: [],
      restartGateway: false,
      rebuild: false,
      install: false,
    };
  }
  const files = changedFiles(git, base, head).map((file) => classify(git, root, base, head, file));
  const active = files.filter((file) => file.action !== "skip" || file.kind === "changed-by-you");
  return {
    state: "updates",
    base,
    head,
    commits: commitsBetween(git, base, head),
    files,
    restartGateway: active.some(
      (file) => file.path.startsWith("gateway/") || file.path.startsWith("src/shared/"),
    ),
    rebuild: active.some((file) => areaOf(file.path) !== "docs" && file.kind !== "generated"),
    install: active.some((file) => file.path === "package.json"),
  };
}

export interface ApplyResult {
  branch: string;
  head: string;
  applied: FileReport[];
  conflicts: { path: string; reason: string }[];
  committed: boolean;
}

function mergeThree(
  root: string,
  mine: Buffer,
  base: Buffer | null,
  theirs: Buffer,
): { merged: Buffer; conflict: string | null } {
  const dir = join(root, WORK_DIR);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, data: Buffer) => {
    const file = join(dir, name);
    writeFileSync(file, data);
    return file;
  };
  const ours = write("ours", mine);
  const original = write("base", base ?? Buffer.alloc(0));
  const incoming = write("theirs", theirs);
  try {
    const result = spawnSync(
      "git",
      [
        "merge-file",
        "-p",
        "-L",
        "yours",
        "-L",
        "synced upstream",
        "-L",
        "new upstream",
        ours,
        original,
        incoming,
      ],
      { cwd: root, maxBuffer: 256 * 1024 * 1024 },
    );
    const code = result.status ?? -1;
    if (code < 0 || code > 127) {
      return { merged: mine, conflict: "could not be merged (binary or unreadable): kept yours" };
    }
    return {
      merged: result.stdout,
      conflict: code > 0 ? `${code} conflicting ${code === 1 ? "section" : "sections"}` : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ApplyOptions extends CheckOptions {
  name?: string;
  now?: () => Date;
}

/** Applies upstream to a new branch. Needs a clean working tree. */
export function apply(options: ApplyOptions): ApplyResult {
  const { root } = options;
  const git = options.git ?? createGit(root);
  if (text(git, ["status", "--porcelain"]) !== "") {
    throw new Error("Your working tree has uncommitted changes. Commit or move them first.");
  }
  const report = check({ ...options, git });
  if (report.state === "unknown-base") {
    throw new Error(
      `No base to compare against: run \`record --sha <commit>\` or \`guess\` first.`,
    );
  }
  if (report.state === "up-to-date") {
    return {
      branch: text(git, ["branch", "--show-current"]),
      head: report.head,
      applied: [],
      conflicts: [],
      committed: false,
    };
  }
  const base = report.base!;
  const stamp = (options.now ?? (() => new Date()))()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  const branch = options.name ?? `update-from-upstream-${stamp}-${report.head.slice(0, 7)}`;
  git(["switch", "-c", branch]);
  const conflicts: ApplyResult["conflicts"] = [];
  const applied: FileReport[] = [];
  for (const file of report.files) {
    if (file.action === "skip") continue;
    const target = join(root, file.path);
    if (file.action === "delete") {
      rmSync(target, { force: true });
    } else {
      const theirs = blobAt(git, report.head, file.path)!;
      if (file.action === "merge") {
        const merged = mergeThree(
          root,
          readLocal(root, file.path)!,
          blobAt(git, base, file.path),
          theirs,
        );
        writeFileSync(target, merged.merged);
        if (merged.conflict) conflicts.push({ path: file.path, reason: merged.conflict });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, theirs);
      }
    }
    applied.push(file);
  }
  writeState(root, {
    upstream: readState(root)?.upstream ?? options.url ?? UPSTREAM_URL,
    branch: options.branch ?? readState(root)?.branch ?? "main",
    sha: report.head,
    syncedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  let committed = false;
  if (conflicts.length === 0) {
    git(["add", "-A"]);
    git(["commit", "--quiet", "-m", `Update from upstream ${report.head.slice(0, 7)}`]);
    committed = true;
  }
  return { branch, head: report.head, applied, conflicts, committed };
}

/**
 * Guesses which upstream commit a copy was made from: the one whose files differ from the copy's
 * the least (protected and generated paths ignored). For a copy with no `.template-sync.json`.
 */
export function guessBase(
  git: Git,
  head: string,
  limit = 300,
): { sha: string; differing: number; compared: number }[] {
  const mine = new Map<string, string>();
  for (const line of git(["ls-files", "-s", "-z"]).stdout.toString().split("\0").filter(Boolean)) {
    const [meta, path] = line.split("\t");
    if (meta && path) mine.set(path, meta.split(" ")[1]!);
  }
  const scored: { sha: string; differing: number; compared: number }[] = [];
  const commits = text(git, ["rev-list", "--first-parent", `--max-count=${limit}`, head]).split(
    "\n",
  );
  for (const sha of commits.filter(Boolean)) {
    const theirs = new Map<string, string>();
    for (const line of git(["ls-tree", "-r", "-z", sha])
      .stdout.toString()
      .split("\0")
      .filter(Boolean)) {
      const [meta, path] = line.split("\t");
      if (meta && path && !classifyPath(path)) theirs.set(path, meta.split(" ")[2]!);
    }
    let differing = 0;
    for (const [path, blob] of theirs) if (mine.get(path) !== blob) differing += 1;
    scored.push({ sha, differing, compared: theirs.size });
  }
  return scored.sort((a, b) => a.differing - b.differing).slice(0, 5);
}

function format(report: CheckReport): string {
  if (report.state === "unknown-base") {
    return "Can't tell which upstream version this copy came from. Run `guess` or `record --sha`.";
  }
  if (report.state === "up-to-date")
    return `Up to date with upstream (${report.head.slice(0, 7)}).`;
  const lines = [
    `${report.commits.length} new upstream commits (${report.base!.slice(0, 7)}..${report.head.slice(0, 7)}):`,
  ];
  for (const commit of report.commits)
    lines.push(`  ${commit.sha.slice(0, 7)} ${commit.subject}  [${commit.areas.join(", ")}]`);
  lines.push("", "Files:");
  for (const file of report.files) {
    lines.push(
      `  ${file.kind.padEnd(15)} ${file.action.padEnd(6)} ${file.path}${file.note ? `  (${file.note})` : ""}`,
    );
  }
  if (report.install) lines.push("", "package.json changed: run `npm install`.");
  if (report.rebuild) lines.push("The canvas needs a rebuild and Reload extensions.");
  if (report.restartGateway)
    lines.push("gateway/ or src/shared/ changed: restart the phone gateway.");
  return lines.join("\n");
}

/** The recurring check: tell the phone there is news. Never applies anything; a missing gateway is fine. */
function notifyPhone(root: string, report: CheckReport): void {
  const count = report.commits.length;
  spawnSync(
    process.execPath,
    [
      join(root, "scripts", "notify.mts"),
      "Updates available",
      `${count} new ${count === 1 ? "change" : "changes"} from upstream. Ask Copilot: update my copy from upstream.`,
    ],
    { cwd: root, stdio: "ignore" },
  );
}

function main(argv: string[]): number {
  const [command = "check", ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      json: { type: "boolean", default: false },
      notify: { type: "boolean", default: false },
      upstream: { type: "string" },
      branch: { type: "string" },
      name: { type: "string" },
      sha: { type: "string" },
    },
  });
  const root = createGit(process.cwd())(["rev-parse", "--show-toplevel"]).stdout.toString().trim();
  const git = createGit(root);
  const base = {
    root,
    git,
    ...(values.upstream ? { url: values.upstream } : {}),
    ...(values.branch ? { branch: values.branch } : {}),
  };
  const print = (value: unknown, human: string) =>
    console.log(values.json ? JSON.stringify(value, null, 2) : human);
  try {
    if (command === "check") {
      const report = check(base);
      print(report, format(report));
      if (report.state === "updates" && values.notify) notifyPhone(root, report);
      return report.state === "updates" ? 10 : 0;
    }
    if (command === "apply") {
      const result = apply({ ...base, ...(values.name ? { name: values.name } : {}) });
      print(
        result,
        [
          `Branch ${result.branch} at upstream ${result.head.slice(0, 7)}.`,
          `${result.applied.length} files updated.`,
          result.conflicts.length
            ? `Resolve these, then commit:\n${result.conflicts.map((item) => `  ${item.path}: ${item.reason}`).join("\n")}`
            : result.committed
              ? "Committed."
              : "Nothing to apply.",
        ].join("\n"),
      );
      return 0;
    }
    if (command === "record") {
      const url = values.upstream ?? UPSTREAM_URL;
      const branch = values.branch ?? "main";
      let sha = values.sha;
      if (!sha) {
        const listed = spawnSync("git", ["ls-remote", url, `refs/heads/${branch}`], { cwd: root });
        sha = listed.stdout?.toString().split(/\s+/)[0];
      }
      if (!sha || !/^[0-9a-f]{40}$/.test(sha))
        throw new Error("Could not read the upstream commit.");
      writeState(root, { upstream: url, branch, sha, syncedAt: new Date().toISOString() });
      print({ sha }, `Recorded upstream ${sha.slice(0, 7)} in ${SYNC_FILE}.`);
      return 0;
    }
    if (command === "guess") {
      const head = fetchUpstream(git, values.upstream ?? UPSTREAM_URL, values.branch ?? "main");
      const best = guessBase(git, head);
      print(
        best,
        best
          .map(
            (item) => `${item.sha.slice(0, 7)}  ${item.differing} of ${item.compared} files differ`,
          )
          .join("\n"),
      );
      return 0;
    }
    console.error("Usage: upstream-sync.mts check | apply | record | guess");
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  existsSync(process.argv[1])
) {
  process.exit(main(process.argv.slice(2)));
}
