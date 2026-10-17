// The canvas: opens a panel that points at the shared provider. One provider serves every
// open instance; it starts on the first open and stops (with a new generation next time) when
// the last instance closes. The canvas belongs to the session that loaded this extension: an open
// request for any other session is refused rather than showing the wrong transcript.
export const SESSION_MISMATCH = "session_mismatch";
/** Short canvas status text for the app chrome. */
export function describeStatus(status) {
    if (!status)
        return "Connecting";
    if (status.phase === "waiting")
        return "Waiting for you";
    if (status.phase === "working")
        return "Working";
    return "Ready";
}
const OPEN_INPUT_SCHEMA = Object.freeze({
    type: "object",
    properties: {},
    additionalProperties: true,
});
function defaultError(code, message) {
    return Object.assign(new Error(message), { code });
}
/**
 * `createCanvas` is the SDK factory (injected so only extension.mts imports the SDK).
 * `ensureProvider()` is called whenever no provider is running and must resolve to
 * `{ url, close() }`. `getStatus()` returns the session status when known. `getSessionId()`
 * resolves to the id of the session this extension joined. `createError` builds the structured
 * error returned to the host (the SDK's CanvasError).
 */
export function createChatCanvas(input) {
    const { config, createCanvas, ensureProvider, getStatus = () => null, getSessionId = () => null, createError = defaultError, log = () => { }, } = input;
    const instances = new Set();
    let provider = null;
    let starting = null;
    let stopping = Promise.resolve();
    async function acquire() {
        await stopping;
        if (provider)
            return provider;
        if (!starting) {
            starting = ensureProvider().then((started) => {
                provider = started;
                starting = null;
                return started;
            }, (error) => {
                starting = null;
                throw error;
            });
        }
        return starting;
    }
    function release() {
        if (instances.size > 0 || !provider)
            return stopping;
        const closing = provider;
        provider = null;
        stopping = stopping
            .then(() => closing.close())
            .catch((error) => {
            log(`Provider close failed: ${error instanceof Error ? error.message : "error"}`, "warning");
        });
        return stopping;
    }
    const canvas = createCanvas({
        id: config.canvasId,
        displayName: config.assistantName,
        description: config.description,
        inputSchema: { ...OPEN_INPUT_SCHEMA },
        actions: [
            {
                name: "status",
                description: "Reports whether the canvas is running, how many are open and the session phase.",
                inputSchema: { type: "object", properties: {}, additionalProperties: false },
                handler: () => ({
                    running: provider !== null,
                    openPanels: instances.size,
                    status: describeStatus(getStatus()),
                }),
            },
        ],
        async open(ctx) {
            if (ctx.sessionId) {
                const own = await getSessionId();
                if (own && ctx.sessionId !== own) {
                    throw createError(SESSION_MISMATCH, `This ${config.assistantName} canvas belongs to another session. Open it from that session's chat.`);
                }
            }
            // Registered first so a concurrent close cannot stop the provider this open is about to use.
            instances.add(ctx.instanceId);
            let running;
            try {
                running = await acquire();
            }
            catch (error) {
                instances.delete(ctx.instanceId);
                throw error;
            }
            running.markOpened?.();
            return {
                url: running.url,
                title: config.assistantName,
                status: describeStatus(getStatus()),
            };
        },
        async onClose(ctx) {
            instances.delete(ctx.instanceId);
            await release();
        },
    });
    return {
        canvas,
        async shutdown() {
            instances.clear();
            if (starting) {
                try {
                    await starting;
                }
                catch {
                    // Nothing to stop.
                }
            }
            await release();
            await stopping;
        },
    };
}
