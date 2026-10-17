import { describeSessionError } from "../logging.mts";
import type { Logger } from "../logging.mts";

/** Experimental like the other RPCs, so feature-detected before use. */
export interface ExtensionsRpcLike {
  reload?: () => Promise<void>;
}
interface ActionSession {
  readonly rpc?: {
    extensions?: ExtensionsRpcLike;
    abort?: (params: { reason?: string }) => Promise<unknown>;
  };
}

export function createSessionActions(session: ActionSession, log: Logger) {
  let disposed = false;
  let reloadScheduled = false;

  /** Reply first: reloading this extension restarts its provider. */
  function reloadExtensions(): boolean {
    if (disposed) return false;
    let api: ExtensionsRpcLike | undefined;
    try {
      api = session.rpc?.extensions;
    } catch {
      return false;
    }
    if (!api || typeof api.reload !== "function") return false;
    if (!reloadScheduled) {
      reloadScheduled = true;
      setTimeout(() => {
        Promise.resolve()
          .then(() => api.reload?.())
          .catch((error: unknown) => {
            log(`Reloading extensions failed: ${describeSessionError(error)}`, "warning");
          })
          .finally(() => {
            reloadScheduled = false;
          });
      }, 250);
    }
    return true;
  }
  async function stop(): Promise<"stopped" | "unavailable" | "failed"> {
    if (disposed) return "unavailable";
    const rpc = session.rpc;
    if (!rpc || typeof rpc.abort !== "function") return "unavailable";
    try {
      const result: unknown = await rpc.abort({ reason: "user_initiated" });
      const ok =
        typeof result === "object" && result !== null && "success" in result && result.success;
      return ok === true ? "stopped" : "failed";
    } catch (error) {
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
