import { describeSessionError } from "../logging.mjs";
export function createSessionActions(session, log) {
    let disposed = false;
    let reloadScheduled = false;
    /** Reply first: reloading this extension restarts its provider. */
    function reloadExtensions() {
        if (disposed)
            return false;
        let api;
        try {
            api = session.rpc?.extensions;
        }
        catch {
            return false;
        }
        if (!api || typeof api.reload !== "function")
            return false;
        if (!reloadScheduled) {
            reloadScheduled = true;
            setTimeout(() => {
                Promise.resolve()
                    .then(() => api.reload?.())
                    .catch((error) => {
                    log(`Reloading extensions failed: ${describeSessionError(error)}`, "warning");
                })
                    .finally(() => {
                    reloadScheduled = false;
                });
            }, 250);
        }
        return true;
    }
    async function stop() {
        if (disposed)
            return "unavailable";
        const rpc = session.rpc;
        if (!rpc || typeof rpc.abort !== "function")
            return "unavailable";
        try {
            const result = await rpc.abort({ reason: "user_initiated" });
            const ok = typeof result === "object" && result !== null && "success" in result && result.success;
            return ok === true ? "stopped" : "failed";
        }
        catch (error) {
            log(`Stopping the turn failed: ${describeSessionError(error)}`, "warning");
            return "failed";
        }
    }
    return {
        reloadExtensions,
        stop,
        dispose() {
            disposed = true;
        },
    };
}
