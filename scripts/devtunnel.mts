// Open the canvas on your phone: sets up an owner-only dev tunnel once, then hosts it and runs the
// gateway until you press Ctrl+C. Usage: npm run devtunnel
//
// The tunnel id is kept in the private runtime directory (never in the repo). Nothing here grants
// anonymous, tenant or organization access, and an existing tunnel with extra access is refused.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, runtimeDir } from "../src/shared/node/config.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The browser URL `devtunnel host` prints for `port`; its hostname is not the tunnel id. */
export function parseForwardingUrl(output: string, port: number): string | null {
  for (const match of output.matchAll(/https:\/\/[A-Za-z0-9.-]+/g)) {
    const url = new URL(match[0]);
    if (url.hostname.split(".")[0]?.endsWith(`-${port}`)) return url.origin;
  }
  return null;
}

/** True when `devtunnel access list --json` grants nothing beyond the owner. */
export function isOwnerOnly(json: string): boolean {
  try {
    const { accessControlEntries } = JSON.parse(json) as { accessControlEntries?: unknown };
    return Array.isArray(accessControlEntries) && accessControlEntries.length === 0;
  } catch {
    return false;
  }
}

function devtunnel(args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("devtunnel", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      "The devtunnel CLI is not installed. Windows: winget install Microsoft.devtunnel; " +
        "macOS: brew install --cask devtunnel. Then run npm run devtunnel again.",
    );
  }
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}` };
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

function ensureSignedIn(): void {
  if (/Logged in as/i.test(devtunnel(["user", "show"]).out)) return;
  console.log("Sign in to dev tunnels with GitHub (the account you will also use on your phone):");
  const login = spawnSync("devtunnel", ["user", "login", "-g", "-d"], { stdio: "inherit" });
  if (login.status !== 0) fail("Sign-in did not finish. Run npm run devtunnel again.");
}

/** A readable tunnel id from the computer's user name, like `jordan-canvas`; null if none fits. */
export function tunnelName(user: string): string | null {
  const slug = user
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug ? `${slug}-canvas` : null;
}

function ensureTunnel(statePath: string): string {
  let tunnelId: string | undefined;
  try {
    tunnelId = (JSON.parse(readFileSync(statePath, "utf8")) as { tunnelId?: string }).tunnelId;
  } catch {
    // First run.
  }
  if (tunnelId && devtunnel(["show", tunnelId, "--json"]).ok) return tunnelId;

  const options = ["--expiration", "30d", "--description", "Copilot Canvas (owner-only)", "--json"];
  // Tunnel ids are unique across all users, so a taken name falls back to a random one.
  const name = tunnelName(userInfo().username);
  let created = name ? devtunnel(["create", name, ...options]) : null;
  if (!created?.ok) created = devtunnel(["create", ...options]);
  try {
    tunnelId = (JSON.parse(created.out) as { tunnel: { tunnelId: string } }).tunnel.tunnelId;
  } catch {
    fail(`Could not create a dev tunnel:\n${created.out}`);
  }
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ tunnelId }) + "\n", { mode: 0o600 });
  console.log(`Created owner-only dev tunnel ${tunnelId}.`);
  return tunnelId;
}

function ensurePort(tunnelId: string, port: number): void {
  const existing = devtunnel(["port", "show", tunnelId, "-p", String(port), "--json"]);
  // The gateway checks the phone's exact Origin, so it must reach it unchanged. The Host header
  // keeps its default rewrite to localhost:<port>, which is what the gateway accepts.
  if (existing.ok && /"originRequestHeader":\s*"unchanged"/.test(existing.out)) return;
  if (existing.ok) devtunnel(["port", "delete", tunnelId, "-p", String(port)]);
  const created = devtunnel([
    "port",
    "create",
    tunnelId,
    "-p",
    String(port),
    "--protocol",
    "http",
    "--origin-header",
    "unchanged",
  ]);
  if (!created.ok) fail(`Could not add port ${port} to the tunnel:\n${created.out}`);
}

function ensureOwnerOnly(tunnelId: string, port: number): void {
  for (const scope of [[], ["-p", String(port)]]) {
    if (!isOwnerOnly(devtunnel(["access", "list", tunnelId, ...scope, "--json"]).out)) {
      fail(
        `Tunnel ${tunnelId} grants access beyond you. Remove those entries with ` +
          "`devtunnel access reset`, or delete the tunnel, then run npm run devtunnel again.",
      );
    }
  }
}

function stopAll(children: ChildProcess[]): void {
  for (const child of children) if (child.exitCode === null) child.kill();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig(repoRoot);
  const port = config.gatewayPort;
  ensureSignedIn();
  const tunnelId = ensureTunnel(join(runtimeDir(config), "phone.json"));
  ensurePort(tunnelId, port);
  ensureOwnerOnly(tunnelId, port);

  const children: ChildProcess[] = [];
  const host = spawn("devtunnel", ["host", tunnelId], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(host);
  let output = "";
  let gatewayStarted = false;
  host.stdout.setEncoding("utf8");
  host.stdout.on("data", (chunk: string) => {
    if (gatewayStarted) return;
    output += chunk;
    const origin = parseForwardingUrl(output, port);
    if (!origin) return;
    gatewayStarted = true;
    const gateway = spawn(process.execPath, [join(repoRoot, "gateway", "gateway.mts")], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, GATEWAY_ALLOWED_ORIGIN: origin, GATEWAY_PORT: String(port) },
    });
    children.push(gateway);
    gateway.on("exit", (code) => {
      stopAll(children);
      process.exit(code ?? 0);
    });
    console.log(
      "Keep this running (and this computer awake) while you use the canvas on your phone.",
    );
  });
  host.on("exit", (code) => {
    stopAll(children);
    fail(`The tunnel host stopped (exit ${code}).${gatewayStarted ? "" : `\n${output}`}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopAll(children);
      process.exit(0);
    });
  }
}
