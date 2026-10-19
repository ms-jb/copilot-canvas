import type { PendingPrompt, PermissionKind, PlanAction } from "../../shared";

const PERMISSION_TITLES: Record<PermissionKind, string> = {
  command: "run a command",
  write: "edit a file",
  read: "read a file",
  path: "access these locations",
  url: "open a web address",
  mcp: "use a tool",
  tool: "use a tool",
  memory: "save a memory",
  extension: "change an extension",
  workflow: "run a workflow",
  other: "continue",
};

export const DETAIL_LABELS: Record<PermissionKind, string> = {
  command: "Command",
  write: "Change",
  read: "Location",
  path: "Locations",
  url: "Address",
  mcp: "Arguments",
  tool: "Arguments",
  memory: "Memory",
  extension: "Details",
  workflow: "Workflow",
  other: "Details",
};

export const PLAN_ACTION_LABELS: Record<PlanAction, string> = {
  interactive: "Approve and start",
  autopilot: "Approve on autopilot",
  autopilot_fleet: "Approve on autopilot, in parallel",
  exit_only: "Approve, don't start yet",
};

export function promptTitle(prompt: PendingPrompt, assistantName: string): string {
  switch (prompt.kind) {
    case "permission":
      return `Allow ${assistantName} to ${PERMISSION_TITLES[prompt.permission]}?`;
    case "question":
      return `${assistantName} has a question`;
    case "form":
      return `${assistantName} needs a few details`;
    case "plan":
      return "Approve this plan?";
  }
}
