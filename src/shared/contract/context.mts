import { isPlainObject } from "./validation.mts";

/** How full the session's context window is, as the session reported it. Never estimated. */
export interface ContextUsage {
  /** Tokens in the window now: system prompt, conversation and tool definitions. */
  currentTokens: number;
  /** The model's prompt token limit (the denominator the CLI shows). */
  tokenLimit: number;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
  messages?: number;
  /** Token count at which the session compacts in the background on its own. */
  compactionThreshold?: number;
}

export interface CompactionReport {
  success: boolean;
  tokensRemoved?: number;
  messagesRemoved?: number;
  /** ISO 8601 time the provider saw it finish. */
  at: string;
}

export interface ContextState {
  /** Null until the session reports a figure (after its first turn, or a refresh). */
  usage: ContextUsage | null;
  compacting: boolean;
  lastCompaction?: CompactionReport;
  /** Whether this Copilot version can re-read its context usage. */
  actions: { refresh: boolean };
}

export const CONTEXT_LIMITS = Object.freeze({
  readTimeoutMs: 5000,
  /** A compaction the session never reports finished is given up on after this long. */
  compactTimeoutMs: 180000,
});

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const optionalCount = (value: unknown) => value === undefined || count(value);

export function validateContextUsage(value: unknown): value is ContextUsage {
  return (
    isPlainObject(value) &&
    count(value.currentTokens) &&
    count(value.tokenLimit) &&
    value.tokenLimit > 0 &&
    optionalCount(value.systemTokens) &&
    optionalCount(value.conversationTokens) &&
    optionalCount(value.toolDefinitionsTokens) &&
    optionalCount(value.messages) &&
    optionalCount(value.compactionThreshold)
  );
}

export function validateContextState(value: unknown): value is ContextState {
  if (!isPlainObject(value) || !isPlainObject(value.actions)) return false;
  const last = value.lastCompaction;
  return (
    (value.usage === null || validateContextUsage(value.usage)) &&
    typeof value.compacting === "boolean" &&
    typeof value.actions.refresh === "boolean" &&
    (last === undefined ||
      (isPlainObject(last) &&
        typeof last.success === "boolean" &&
        typeof last.at === "string" &&
        optionalCount(last.tokensRemoved) &&
        optionalCount(last.messagesRemoved)))
  );
}
