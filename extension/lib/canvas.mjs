// The chat canvas: opens a panel that points at the shared provider. One provider serves every
// open instance; it starts on the first open and stops (with a new generation next time) when
// the last instance closes.
const OPEN_INPUT_SCHEMA = Object.freeze({
    type: "object",
    properties: {},
    additionalProperties: true,
});
/**
 * `createCanvas` is the SDK factory (injected so only extension.mts imports the SDK).
 * `ensureProvider()` is called whenever no provider is running and must resolve to
 * `{ url, close() }`.
 */
export function createChatCanvas(input) {
    const { config, createCanvas, ensureProvider, log = () => { } } = input;
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
        displayName: config.displayName,
        description: config.description,
        inputSchema: { ...OPEN_INPUT_SCHEMA },
        actions: [
            {
                name: "status",
                description: "Reports whether the chat panel is running and how many panels are open.",
                inputSchema: { type: "object", properties: {}, additionalProperties: false },
                handler: () => ({ running: provider !== null, openPanels: instances.size }),
            },
        ],
        async open(ctx) {
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
            return { url: running.url, title: config.displayName, status: "Connected to this session" };
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
