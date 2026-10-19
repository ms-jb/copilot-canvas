import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import {
  apply,
  check,
  classifyPath,
  createGit,
  guessBase,
  readState,
  writeState,
  SYNC_FILE,
} from "../scripts/upstream-sync.mts";

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(join(process.cwd(), "tests", ".sync-"));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

function repo(name: string) {
  const root = join(workspace, name);
  mkdirSync(root, { recursive: true });
  const git = createGit(root);
  git(["init", "--quiet", "-b", "main"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.test"]);
  git(["config", "commit.gpgsign", "false"]);
  const write = (path: string, content: string | null) => {
    const file = join(root, path);
    if (content === null) return rmSync(file, { force: true });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const commit = (message: string) => {
    git(["add", "-A"]);
    git(["commit", "--quiet", "-m", message]);
    return git(["rev-parse", "HEAD"]).stdout.toString().trim();
  };
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  return { root, git, write, commit, read };
}

const BASE_FILES: Record<string, string> = {
  "a.txt": "one\ntwo\nthree\n",
  "b.txt": "b1\n",
  "c.txt": "c1\n",
  "template.config.json": '{"assistantName":"Copilot"}\n',
  "extension/ui/x.js": "built v1\n",
  "ui/public/assets/icon.svg": "<svg>v1</svg>\n",
};

/** An upstream with one base commit, and a copy made from it (no shared history). */
function setup() {
  const upstream = repo("upstream");
  for (const [path, content] of Object.entries(BASE_FILES)) upstream.write(path, content);
  const base = upstream.commit("Base (#1)");
  const copy = repo("copy");
  for (const [path, content] of Object.entries(BASE_FILES)) copy.write(path, content);
  copy.write(".gitignore", ".runtime/\n");
  copy.commit("Initial commit");
  writeState(copy.root, { upstream: upstream.root, branch: "main", sha: base, syncedAt: "" });
  copy.commit("Record sync");
  return { upstream, copy, base };
}

it("classifies what upstream changed against what the copy kept, changed or made its own", () => {
  const { upstream, copy } = setup();
  copy.write("a.txt", "ONE\ntwo\nthree\n");
  copy.write("c.txt", "c-mine\n");
  copy.write("template.config.json", '{"assistantName":"Atlas"}\n');
  copy.commit("My changes");
  upstream.write("a.txt", "one\ntwo\nTHREE\n");
  upstream.write("b.txt", "b2\n");
  upstream.write("c.txt", null);
  upstream.write("d.txt", "new\n");
  upstream.write("gateway/g.mts", "export {};\n");
  upstream.write("template.config.json", '{"assistantName":"Copilot","x":1}\n');
  upstream.write("extension/ui/x.js", "built v2\n");
  upstream.write("ui/public/assets/icon.svg", "<svg>v2</svg>\n");
  upstream.write("README.md", "docs\n");
  upstream.commit("Change many things (#2)");

  const report = check({ root: copy.root, url: upstream.root });
  expect(report.state).toBe("updates");
  expect(report.commits).toMatchObject([{ subject: "Change many things (#2)" }]);
  const byPath = Object.fromEntries(report.files.map((file) => [file.path, file]));
  expect(byPath["a.txt"]).toMatchObject({ kind: "changed-by-you", action: "merge" });
  expect(byPath["b.txt"]).toMatchObject({ kind: "untouched", action: "update" });
  expect(byPath["c.txt"]).toMatchObject({ kind: "changed-by-you", action: "skip" });
  expect(byPath["d.txt"]).toMatchObject({ kind: "untouched", action: "add" });
  expect(byPath["gateway/g.mts"]).toMatchObject({ kind: "untouched", action: "add" });
  expect(byPath["template.config.json"]).toMatchObject({ kind: "protected", action: "skip" });
  expect(byPath["ui/public/assets/icon.svg"]).toMatchObject({ kind: "protected", action: "skip" });
  expect(byPath["extension/ui/x.js"]).toMatchObject({ kind: "generated", action: "skip" });
  expect(report).toMatchObject({ restartGateway: true, rebuild: true, install: false });
});

it("applies on a new branch: fast-forwards, merges around the copy's edits, keeps personalization", () => {
  const { upstream, copy } = setup();
  copy.write("a.txt", "ONE\ntwo\nthree\n");
  copy.write("template.config.json", '{"assistantName":"Atlas"}\n');
  copy.commit("My changes");
  upstream.write("a.txt", "one\ntwo\nTHREE\n");
  upstream.write("b.txt", "b2\n");
  upstream.write("d.txt", "new\n");
  upstream.write("template.config.json", '{"assistantName":"Other"}\n');
  upstream.write("extension/ui/x.js", "built v2\n");
  const head = upstream.commit("Change (#2)");

  const result = apply({ root: copy.root, url: upstream.root, now: () => new Date("2026-10-19") });
  expect(result).toMatchObject({ committed: true, conflicts: [], head });
  expect(result.branch).toBe(`update-from-upstream-20261019-${head.slice(0, 7)}`);
  expect(copy.git(["branch", "--show-current"]).stdout.toString().trim()).toBe(result.branch);
  expect(copy.read("a.txt")).toBe("ONE\ntwo\nTHREE\n");
  expect(copy.read("b.txt")).toBe("b2\n");
  expect(copy.read("d.txt")).toBe("new\n");
  expect(copy.read("template.config.json")).toBe('{"assistantName":"Atlas"}\n');
  expect(copy.read("extension/ui/x.js")).toBe("built v1\n");
  expect(readState(copy.root)?.sha).toBe(head);
  // The original branch is untouched, and the remote can't be pushed to.
  expect(copy.git(["show", "main:b.txt"]).stdout.toString()).toBe("b1\n");
  expect(copy.git(["remote", "get-url", "--push", "upstream"]).stdout.toString().trim()).toBe(
    "DISABLED",
  );
  expect(existsSync(join(copy.root, ".runtime/upstream-sync"))).toBe(false);
  // Nothing left to do afterwards.
  copy.git(["switch", "--quiet", result.branch]);
  expect(check({ root: copy.root, url: upstream.root }).state).toBe("up-to-date");
});

it("leaves conflict markers for a person, keeps both sides and does not commit", () => {
  const { upstream, copy } = setup();
  copy.write("a.txt", "mine\ntwo\nthree\n");
  copy.commit("My changes");
  upstream.write("a.txt", "theirs\ntwo\nthree\n");
  upstream.write("b.txt", "b2\n");
  upstream.commit("Change (#2)");

  const result = apply({ root: copy.root, url: upstream.root });
  expect(result.committed).toBe(false);
  expect(result.conflicts).toEqual([{ path: "a.txt", reason: "1 conflicting section" }]);
  const merged = copy.read("a.txt");
  expect(merged).toContain("<<<<<<< yours\nmine\n");
  expect(merged).toContain("theirs\n>>>>>>> new upstream");
  expect(copy.read("b.txt")).toBe("b2\n");
});

it("refuses a dirty working tree, and reports an unknown base instead of guessing", () => {
  const { upstream, copy } = setup();
  copy.write("a.txt", "uncommitted\n");
  expect(() => apply({ root: copy.root, url: upstream.root })).toThrow(/uncommitted/);
  rmSync(join(copy.root, SYNC_FILE));
  copy.write("a.txt", BASE_FILES["a.txt"]!);
  copy.commit("No sync file");
  expect(check({ root: copy.root, url: upstream.root })).toMatchObject({
    state: "unknown-base",
    base: null,
  });
});

it("guesses the upstream commit a copy came from by the files that still match", () => {
  const upstream = repo("upstream");
  upstream.write("a.txt", "1\n");
  upstream.write("b.txt", "1\n");
  const first = upstream.commit("one");
  upstream.write("a.txt", "2\n");
  const second = upstream.commit("two");
  upstream.write("b.txt", "2\n");
  upstream.write("template.config.json", "{}\n");
  const third = upstream.commit("three");
  const copy = repo("copy");
  copy.write("a.txt", "2\n");
  copy.write("b.txt", "1\n");
  copy.write("template.config.json", '{"mine":true}\n');
  copy.commit("Copy");
  copy.git(["remote", "add", "upstream", upstream.root]);
  copy.git(["fetch", "--quiet", "upstream", "main"]);
  const head = copy.git(["rev-parse", "upstream/main"]).stdout.toString().trim();
  const [best, ...others] = guessBase(copy.git, head);
  expect(best).toMatchObject({ sha: second, differing: 0 });
  expect(others.map((item) => item.sha).sort()).toEqual([first, third].sort());
  expect(others.every((item) => item.differing > 0)).toBe(true);
});

it("knows which paths are personalization and which are rebuilt", () => {
  for (const path of [
    "template.config.json",
    ".template-sync.json",
    "ui/public/assets/icon-192.png",
  ]) {
    expect(classifyPath(path)).toBe("protected");
  }
  for (const path of ["extension/ui/index.html", "package-lock.json"]) {
    expect(classifyPath(path)).toBe("generated");
  }
  expect(classifyPath("ui/src/views/registry.ts")).toBeNull();
});
