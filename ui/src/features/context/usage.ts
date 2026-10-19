// Context window arithmetic for the meter. Pure, so the thresholds and labels are tested once.
import type { CompactionReport, ContextUsage } from "../../shared";

export type UsageTone = "ok" | "warn" | "danger";

/** Share of the window in use, 0–100, rounded down so 99.6% never reads as full. */
export function usagePercent(usage: ContextUsage): number {
  if (usage.tokenLimit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((usage.currentTokens / usage.tokenLimit) * 100)));
}

/**
 * Amber from 70% (or near the point where the session compacts itself), red from 85% (or past
 * that point).
 */
export function usageTone(usage: ContextUsage): UsageTone {
  const share = usage.currentTokens / usage.tokenLimit;
  const auto = usage.compactionThreshold;
  if (share >= 0.85 || (auto !== undefined && usage.currentTokens >= auto)) return "danger";
  if (share >= 0.7 || (auto !== undefined && usage.currentTokens >= auto * 0.9)) return "warn";
  return "ok";
}

/** 950, 12.3k, 200k, 1.2M. */
export function formatTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands < 100 ? trim(thousands) : Math.round(thousands)}k`;
  }
  return `${trim(value / 1_000_000)}M`;
}
const trim = (value: number) => String(Math.round(value * 10) / 10);

export interface UsagePart {
  key: "system" | "conversation" | "tools" | "other";
  label: string;
  tokens: number;
  /** Share of the window, 0–100, for a segmented bar. */
  percent: number;
}

/** What fills the window, largest first; "Other" covers what the session didn't itemize. */
export function usageBreakdown(usage: ContextUsage): UsagePart[] {
  const known: Omit<UsagePart, "percent">[] = [
    { key: "system", label: "System prompt", tokens: usage.systemTokens ?? 0 },
    { key: "conversation", label: "Conversation", tokens: usage.conversationTokens ?? 0 },
    { key: "tools", label: "Tool definitions", tokens: usage.toolDefinitionsTokens ?? 0 },
  ];
  const itemized = known.reduce((sum, part) => sum + part.tokens, 0);
  if (itemized === 0) return [];
  const rest = usage.currentTokens - itemized;
  const parts =
    rest > 0 ? [...known, { key: "other" as const, label: "Other", tokens: rest }] : known;
  return parts
    .filter((part) => part.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .map((part) => ({ ...part, percent: (part.tokens / usage.tokenLimit) * 100 }));
}

/** One line for the meter's accessible name and tooltip. */
export function describeUsage(usage: ContextUsage | null): string {
  if (!usage) return "Context usage appears after the first reply";
  return `Context ${usagePercent(usage)}% full: ${formatTokens(usage.currentTokens)} of ${formatTokens(usage.tokenLimit)} tokens`;
}

/** "Freed 40k tokens and 12 messages", "Last compaction failed". */
export function describeCompaction(report: CompactionReport): string {
  if (!report.success) return "The last compaction didn't finish.";
  const freed = [
    report.tokensRemoved ? `${formatTokens(report.tokensRemoved)} tokens` : "",
    report.messagesRemoved
      ? `${report.messagesRemoved} message${report.messagesRemoved === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  return freed.length ? `Compacted, freeing ${freed.join(" and ")}.` : "Compacted.";
}
