import { API, ERROR_CODES, LIMITS, type PromptResponse } from "../shared";
import { field, postJson, type SendContext } from "./http";

export type RespondOutcome =
  | { kind: "accepted" }
  // Already answered elsewhere or no longer waiting: the card simply goes away.
  | { kind: "resolved" }
  | { kind: "rejected"; message: string }
  // The answer may or may not have applied. Never retried automatically.
  | { kind: "uncertain"; message: string }
  | { kind: "stale"; message: string };

const RESPOND_UNCERTAIN =
  "Couldn't confirm your answer reached Copilot. If this request is still here, answer it again.";

/** Sends the user's explicit answer to one pending prompt. */
export async function respondToPrompt(
  context: SendContext,
  requestId: string,
  response: PromptResponse,
): Promise<RespondOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.respondTimeoutMs + 10000);
  let result: { status: number; body: unknown };
  try {
    result = await postJson(
      context,
      API.respond,
      { sessionId: context.sessionId, requestId, response },
      controller.signal,
    );
  } catch {
    return { kind: "uncertain", message: RESPOND_UNCERTAIN };
  } finally {
    clearTimeout(timer);
  }
  return respondOutcome(result.status, result.body);
}

export function respondOutcome(httpStatus: number, body: unknown): RespondOutcome {
  const code = field(body, "code");
  if (code === ERROR_CODES.staleProvider) {
    return { kind: "stale", message: "The provider restarted. Reload this panel." };
  }
  if (httpStatus >= 200 && httpStatus < 300 && field(body, "status") === "accepted") {
    return { kind: "accepted" };
  }
  if (code === ERROR_CODES.promptResolved) return { kind: "resolved" };
  if (code === ERROR_CODES.duplicateRequest) {
    return { kind: "rejected", message: "This request is already being answered." };
  }
  if (
    field(body, "status") === "uncertain" ||
    code === ERROR_CODES.respondUncertain ||
    code === ERROR_CODES.sendUncertain ||
    (httpStatus >= 500 && code === undefined)
  ) {
    return { kind: "uncertain", message: field(body, "message") ?? RESPOND_UNCERTAIN };
  }
  return {
    kind: "rejected",
    message: field(body, "message") ?? `The answer was not sent (${httpStatus}).`,
  };
}
