// Starts one provider (HTTP server + runtime state file) for a session bridge.
import { publishProviderState } from "./provider-state.mjs";
import { createProviderServer } from "./server.mjs";
/** Resolves once the server is listening and its state file is published. */
export async function startProvider(input) {
    const { config, bridge, uiDir, log = () => { }, env = process.env, serverOptions = {} } = input;
    const server = createProviderServer({ ...serverOptions, config, bridge, uiDir, log });
    await server.start();
    const state = publishProviderState({
        config,
        generation: server.generation,
        origin: server.origin,
        capabilityPath: server.capabilityPath,
        env,
        log,
    });
    let closed = false;
    return {
        url: server.url,
        generation: server.generation,
        server,
        async close() {
            if (closed)
                return;
            closed = true;
            state.remove();
            await server.close();
        },
    };
}
