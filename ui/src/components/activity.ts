import type { ActivityItem, ToolState } from "../shared";

/** Thinking stays in every turn; tool calls show only while their turn is running. */
export function visibleActivity(items: readonly ActivityItem[], live: boolean): ActivityItem[] {
  return live ? items.slice() : items.filter((item) => item.kind === "reasoning");
}

/** 182 ms, 2.4 s, 1m 05s. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export const TOOL_STATE_LABEL: Record<ToolState, string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

/** The first line of a thinking block, for its collapsed header. */
export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/[*_#`>]/g, "").trim())
      .find(Boolean) ?? ""
  );
}
