import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";

// Setup starts the phone tunnel from a fresh clone before `npm install` finishes, so the gateway must
// run with no node_modules at all. A new top-level package import would silently bring that wait back.
const root = join(import.meta.dirname, "..", "..");
let directory = "";
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

it("serves the phone link from a clone without node_modules", async () => {
  directory = mkdtempSync(join(tmpdir(), "bare-clone-"));
  for (const entry of ["gateway", "src/shared", "template.config.json"]) {
    cpSync(join(root, entry), join(directory, entry), { recursive: true });
  }
  const port = await freePort();
  const child = spawn(process.execPath, [join(directory, "gateway", "gateway.mts")], {
    cwd: directory,
    env: {
      ...process.env,
      GATEWAY_PORT: String(port),
      GATEWAY_ALLOWED_ORIGIN: `https://test-${port}.usw2.devtunnels.ms`,
      CANVAS_RUNTIME_DIR: join(directory, "runtime"),
    },
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  try {
    const deadline = Date.now() + 15_000;
    while (!output.includes("Open on phone:") && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(output).toContain(`gateway listening on 127.0.0.1:${port}`);
    expect(output).toContain("Open on phone: https://");
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
