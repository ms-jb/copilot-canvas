export type LogLevel = "info" | "warning" | "error";
export type Logger = (message: string, level?: LogLevel) => void;

export function describeSessionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  const trimmed = message.replace(/\s+/g, " ").trim().slice(0, 300);
  return trimmed || "The session did not accept the message.";
}
