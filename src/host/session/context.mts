// Read-only context window usage for the canvas. Usage is only what the session
// reports (`session.usage_info`, `session.compaction_complete`, or `metadata.contextInfo` on
// request), never an estimate. Compaction events are observed, never initiated here.
import { CONTEXT_LIMITS, isPlainObject } from "../../shared/contract.mts";
import type { CompactionReport, ContextState, ContextUsage } from "../../shared/contract.mts";
import type { SessionEventLike } from "../../shared/transcript.mts";
import { describeSessionError } from "../logging.mts";
import type { Logger } from "../logging.mts";
import { readWithTimeout } from "../read-timeout.mts";

/** Experimental RPCs, feature-detected before use. */
export interface ContextRpcLike {
  metadata?: {
    contextInfo?: (params: {
      promptTokenLimit: number;
      outputTokenLimit: number;
    }) => Promise<unknown>;
  };
}

export type ContextReadOutcome = "refreshed" | "unavailable" | "failed";

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function breakdown(data: Record<string, unknown>): Partial<ContextUsage> {
  const parts: Partial<ContextUsage> = {};
  if (count(data.systemTokens)) parts.systemTokens = data.systemTokens;
  if (count(data.conversationTokens)) parts.conversationTokens = data.conversationTokens;
  if (count(data.toolDefinitionsTokens)) parts.toolDefinitionsTokens = data.toolDefinitionsTokens;
  return parts;
}

/** `session.usage_info` data, or null when it lacks a usable figure. */
export function usageFromEvent(data: unknown): ContextUsage | null {
  if (!isPlainObject(data) || !count(data.currentTokens) || !count(data.tokenLimit)) return null;
  if (data.tokenLimit === 0) return null;
  return {
    currentTokens: data.currentTokens,
    tokenLimit: data.tokenLimit,
    ...breakdown(data),
    ...(count(data.messagesLength) ? { messages: data.messagesLength } : {}),
  };
}

/** `metadata.contextInfo` result, or null while the session hasn't initialized. */
export function usageFromContextInfo(result: unknown): ContextUsage | null {
  const info = isPlainObject(result) ? result.contextInfo : undefined;
  if (!isPlainObject(info) || !count(info.totalTokens) || !count(info.promptTokenLimit))
    return null;
  if (info.promptTokenLimit === 0) return null;
  return {
    currentTokens: info.totalTokens,
    tokenLimit: info.promptTokenLimit,
    ...breakdown(info),
    ...(count(info.compactionThreshold) ? { compactionThreshold: info.compactionThreshold } : {}),
  };
}

export function createContextTracker(
  rpc: ContextRpcLike | undefined,
  notify: (state: ContextState) => void,
  {
    log = () => {},
    now = () => new Date(),
    timeoutMs = CONTEXT_LIMITS.compactTimeoutMs,
    readTimeoutMs = CONTEXT_LIMITS.readTimeoutMs,
  }: { log?: Logger; now?: () => Date; timeoutMs?: number; readTimeoutMs?: number } = {},
) {
  const metadata = rpc?.metadata;
  const canRefresh = typeof metadata?.contextInfo === "function";
  let usage: ContextUsage | null = null;
  let threshold: number | undefined;
  let compacting = false;
  let lastCompaction: CompactionReport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let revision = 0;
  let reading: Promise<ContextReadOutcome> | undefined;

  const snapshot = (): ContextState => ({
    usage: usage && threshold !== undefined ? { ...usage, compactionThreshold: threshold } : usage,
    compacting,
    ...(lastCompaction ? { lastCompaction } : {}),
    actions: { refresh: canRefresh },
  });
  const changed = () => {
    if (!disposed) notify(snapshot());
  };
  const setUsage = (next: ContextUsage | null) => {
    revision += 1;
    if (next?.compactionThreshold !== undefined) threshold = next.compactionThreshold;
    // The threshold is a share of the limit; a different model makes the old one meaningless.
    else if (next && usage && next.tokenLimit !== usage.tokenLimit) threshold = undefined;
    usage = next;
  };
  const begin = () => {
    compacting = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!compacting) return;
      compacting = false;
      lastCompaction = { success: false, at: now().toISOString() };
      changed();
    }, timeoutMs);
    timer.unref?.();
  };
  const finish = (report: Omit<CompactionReport, "at">) => {
    compacting = false;
    clearTimeout(timer);
    lastCompaction = { ...report, at: now().toISOString() };
  };

  function applyEvent(event: SessionEventLike): void {
    if (disposed || event.agentId) return;
    const data = event.data ?? {};
    switch (event.type) {
      case "session.usage_info": {
        const next = usageFromEvent(data);
        if (!next) return;
        setUsage(next);
        break;
      }
      case "session.compaction_start":
        if (compacting) return;
        begin();
        break;
      case "session.compaction_complete": {
        const success = data.success === true;
        finish({
          success,
          ...(count(data.tokensRemoved) ? { tokensRemoved: data.tokensRemoved } : {}),
          ...(count(data.messagesRemoved) ? { messagesRemoved: data.messagesRemoved } : {}),
        });
        const limit = count(data.tokenLimit) && data.tokenLimit > 0 ? data.tokenLimit : undefined;
        if (success && count(data.postCompactionTokens) && (limit ?? usage?.tokenLimit)) {
          setUsage({
            currentTokens: data.postCompactionTokens,
            tokenLimit: (limit ?? usage?.tokenLimit)!,
            ...breakdown(data),
          });
        }
        break;
      }
      case "session.context_cleared":
        setUsage(null);
        void refresh();
        break;
      default:
        return;
    }
    changed();
  }

  function refresh(): Promise<ContextReadOutcome> {
    if (reading) return reading;
    reading = read().finally(() => {
      reading = undefined;
    });
    return reading;
  }

  async function read(): Promise<ContextReadOutcome> {
    if (!canRefresh || disposed) return "unavailable";
    const version = revision;
    try {
      const result = await readWithTimeout(
        () =>
          metadata!.contextInfo!.call(metadata, {
            promptTokenLimit: 0,
            outputTokenLimit: 0,
          }),
        readTimeoutMs,
      );
      const next = usageFromContextInfo(result);
      if (!next) return "failed";
      if (!disposed && revision === version) {
        setUsage(next);
        changed();
      }
      return "refreshed";
    } catch (error) {
      log(`Could not read context usage: ${describeSessionError(error)}`, "warning");
      return "failed";
    }
  }

  return {
    snapshot,
    applyEvent,
    refresh,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
export type ContextTracker = ReturnType<typeof createContextTracker>;
