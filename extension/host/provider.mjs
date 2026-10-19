// Starts one provider (HTTP server + private runtime state file) for a session bridge.
// Each Copilot session runs its own extension process and publishes its own state file, keyed by
// session id. The file holds the loopback origin and capability path for the optional gateway:
// never log its contents.
import { dirname } from "node:path";
import { gatewayStatePath, providerStatePathFor, readSourceDir } from "../shared/node/config.mjs";
import { toPublicOrigin } from "../shared/contract.mjs";
import { buildProviderState, isProcessAlive, readGatewayState, readProviderState, removeProviderState, writeProviderState, } from "../shared/node/runtime-state.mjs";
import { createProviderServer } from "./server.mjs";
/**
 * Public root origin for "Open on phone": the running gateway's published origin, else the
 * configured allowed origin. Origin only; never a path or token.
 */
export function readShareInfo(config, env = process.env) {
    const gateway = readGatewayState(gatewayStatePath(config, env));
    const fromGateway = gateway && isProcessAlive(gateway.pid) ? gateway.publicUrl : null;
    return { publicUrl: toPublicOrigin(fromGateway) ?? toPublicOrigin(config.gatewayAllowedOrigin) };
}
/**
 * Writes this session's state file for a listening provider. `markOpened()` refreshes its
 * `openedAt`; `remove()` deletes it only while it still belongs to this generation. Failures are
 * logged, never thrown: the canvas works without the file; only the optional gateway needs it.
 */
function publishProviderState(input) {
    const { config, server, sessionId, env, log } = input;
    const path = providerStatePathFor(config, sessionId, env);
    const state = buildProviderState({
        generation: server.generation,
        origin: server.origin,
        capabilityPath: server.capabilityPath,
        sessionId,
    });
    let removed = false;
    const write = () => {
        try {
            writeProviderState(path, state);
            return true;
        }
        catch (error) {
            const code = error?.code;
            log(`Could not publish provider state: ${code ?? "error"}`, "warning");
            return false;
        }
    };
    write();
    return {
        markOpened() {
            if (removed)
                return;
            const current = readProviderState(path);
            if (current && current.generation !== state.generation)
                return;
            state.openedAt = new Date().toISOString();
            write();
        },
        remove() {
            removed = true;
            try {
                removeProviderState(path, server.generation);
            }
            catch {
                // Already gone or unreadable.
            }
        },
    };
}
/** Resolves once the server is listening and its state file is published. */
export async function startProvider(input) {
    const { config, bridge, sessionId, uiDir, log = () => { }, env = process.env, serverOptions = {}, } = input;
    const server = createProviderServer({
        getShareInfo: () => readShareInfo(config, env),
        getSourceDir: () => (uiDir ? readSourceDir(dirname(uiDir)) : ""),
        ...serverOptions,
        config,
        bridge,
        uiDir,
        log,
    });
    await server.start();
    const published = publishProviderState({ config, server, sessionId, env, log });
    let closed = false;
    return {
        url: server.url,
        generation: server.generation,
        server,
        markOpened() {
            if (!closed)
                published.markOpened();
        },
        async close() {
            if (closed)
                return;
            closed = true;
            published.remove();
            await server.close();
        },
    };
}
