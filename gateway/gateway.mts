// Loopback gateway for an owner-only phone tunnel. Provider selection and request handling live
// under server/; importing this entry point never starts a listener or publishes runtime state.
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  gatewayStatePath,
  loadConfig,
  notifyTokenPath,
  runtimeDir,
  sessionsDir,
} from "../src/shared/node/config.mts";
import {
  buildGatewayState,
  readGatewayState,
  writePrivateJson,
} from "../src/shared/node/runtime-state.mts";
import { publishQr } from "./qr.mts";
import { createGateway } from "./server/gateway.mts";

export { createGateway };
export type { Gateway, GatewayOptions } from "./server/gateway.mts";

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = loadConfig(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const gateway = createGateway({
    port: config.gatewayPort,
    allowedOrigin: config.gatewayAllowedOrigin,
    statePath: process.env.GATEWAY_STATE_FILE || undefined,
    sessionsDir: sessionsDir(config),
    // Notifications need the phone's https origin; keys and subscriptions stay in the runtime folder.
    push: config.gatewayAllowedOrigin
      ? {
          statePath: join(runtimeDir(config), "push.json"),
          assistantName: config.assistantName,
          notifyTokenPath: notifyTokenPath(config),
        }
      : undefined,
  });
  const { port } = await gateway.listen();
  console.log(`gateway listening on 127.0.0.1:${port}`);

  // Publish only the public root origin so the canvas can offer "Open on phone".
  const sharePath = gatewayStatePath(config);
  const share = config.gatewayAllowedOrigin ? buildGatewayState(config.gatewayAllowedOrigin) : null;
  let qr: ReturnType<typeof publishQr> | undefined;
  if (share) {
    writePrivateJson(sharePath, share);
    console.log(`Open on phone: ${share.publicUrl}`);
    console.log("Use an owner-only tunnel and a browser signed in as the tunnel owner.");
    // The QR is also saved as an image so setup can post it in chat; it holds only the public link.
    qr = publishQr({ url: share.publicUrl, imagePath: join(runtimeDir(config), "phone-qr.svg") });
  } else {
    console.log("Set GATEWAY_ALLOWED_ORIGIN to your tunnel origin to enable Open on phone.");
  }
  const removeShare = () => {
    if (share && readGatewayState(sharePath)?.pid === process.pid)
      rmSync(sharePath, { force: true });
  };
  process.on("exit", removeShare);
  const shutdown = () => {
    qr?.stop();
    void gateway.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
