import { API, ERROR_CODES, type QueueChange } from "../shared";
import { field, postJson, type SendContext } from "./http";

export type QueueOutcome =
  | { kind: "done" }
  /** Delivered, removed or changed in another client before this action landed. */
  | { kind: "gone"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "stale"; message: string };

/** Edits, removes or moves one queued message (POST api/queue); every client then sees the new list. */
export async function requestQueueChange(
  context: SendContext,
  change: QueueChange,
): Promise<QueueOutcome> {
  let result: { status: number; body: unknown };
  try {
    result = await postJson(context, API.queue, { sessionId: context.sessionId, ...change });
  } catch {
    return { kind: "failed", message: "Couldn't reach the session. Try again." };
  }
  const { status, body } = result;
  const code = field(body, "code");
  if (code === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (status >= 200 && status < 300 && field(body, "status") === "done") return { kind: "done" };
  const message = field(body, "message") ?? "The queue didn't change.";
  return { kind: code === ERROR_CODES.queueItemGone ? "gone" : "failed", message };
}
