import { ERROR_CODES, SEND_STATUS } from "../../shared/contract.mts";
import type {
  FormValue,
  PendingPrompt,
  PlanAction,
  PromptResponse,
} from "../../shared/contract.mts";
import { isRecord } from "./descriptions.mts";
import { checkFormValues } from "./form-values.mts";
import type { Logger } from "../logging.mts";

type RpcFn<P = never> = (params: P) => Promise<unknown>;

/** The slice of `session.rpc` used for prompts. Every member is optional and feature-detected. */
export interface PromptsRpcLike {
  permissions?: {
    handlePendingPermissionRequest?: RpcFn<{
      requestId: string;
      result: { kind: "approve-once"; approvedInteractively: true } | { kind: "reject" };
      decisionContext?: {
        outcome: "prompted_user";
        source: "human_response";
        surface: "sdk";
        responseCapability: "interactive";
      };
    }>;
    pendingRequests?: () => Promise<unknown>;
  };
  ui?: {
    handlePendingUserInput?: RpcFn<{
      requestId: string;
      response: { answer: string; wasFreeform: boolean };
    }>;
    handlePendingElicitation?: RpcFn<{
      requestId: string;
      result: { action: "accept" | "decline" | "cancel"; content?: Record<string, FormValue> };
    }>;
    handlePendingExitPlanMode?: RpcFn<{
      requestId: string;
      response: { approved: boolean; selectedAction?: PlanAction; feedback?: string };
    }>;
  };
}

export type RespondOutcome =
  | { ok: true; status: "accepted" }
  | { ok: false; status: "rejected" | "uncertain"; code: string; message: string };

export const RESOLVED_MESSAGE = "This request was already answered or is no longer waiting.";
export const rejected = (code: string, message: string): RespondOutcome => ({
  ok: false,
  status: SEND_STATUS.rejected,
  code,
  message,
});

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

type Attempt = { result: unknown } | { error: unknown };

export function createPromptsRpcAdapter(
  session: { readonly rpc?: PromptsRpcLike },
  { timeoutMs, log }: { timeoutMs: number; log: Logger },
) {
  const cancels = new Set<() => void>();
  // Looked up on every use: the experimental surface may change shape at runtime.
  const permissions = () => session.rpc?.permissions;
  const ui = () => session.rpc?.ui;
  const can = {
    permission: () => typeof permissions()?.handlePendingPermissionRequest === "function",
    list: () => typeof permissions()?.pendingRequests === "function",
    question: () => typeof ui()?.handlePendingUserInput === "function",
    form: () => typeof ui()?.handlePendingElicitation === "function",
    plan: () => typeof ui()?.handlePendingExitPlanMode === "function",
  };

  /** Builds the native call without executing it or choosing a decision. */
  function prepare(
    prompt: PendingPrompt,
    response: PromptResponse,
  ): (() => Promise<unknown>) | RespondOutcome {
    const requestId = prompt.requestId;
    if (response.kind !== prompt.kind) {
      return rejected(ERROR_CODES.badRequest, "That answer doesn't match this request.");
    }
    const unavailable = rejected(
      ERROR_CODES.promptUnavailable,
      "This request can't be answered from the canvas.",
    );
    if (response.kind === "permission") {
      const handler = permissions()?.handlePendingPermissionRequest;
      if (typeof handler !== "function") return unavailable;
      return () =>
        handler.call(permissions(), {
          requestId,
          result:
            response.decision === "approve"
              ? { kind: "approve-once", approvedInteractively: true }
              : { kind: "reject" },
          decisionContext: {
            outcome: "prompted_user",
            source: "human_response",
            surface: "sdk",
            responseCapability: "interactive",
          },
        });
    }
    if (response.kind === "question" && prompt.kind === "question") {
      const handler = ui()?.handlePendingUserInput;
      if (typeof handler !== "function") return unavailable;
      if (response.freeform ? !prompt.allowFreeform : !prompt.choices.includes(response.answer)) {
        return rejected(
          ERROR_CODES.badRequest,
          response.freeform
            ? "This question only takes one of its choices."
            : "That isn't one of the choices.",
        );
      }
      return () =>
        handler.call(ui(), {
          requestId,
          response: { answer: response.answer, wasFreeform: response.freeform },
        });
    }
    if (response.kind === "form" && prompt.kind === "form") {
      const handler = ui()?.handlePendingElicitation;
      if (typeof handler !== "function") return unavailable;
      if (response.action !== "accept") {
        return () => handler.call(ui(), { requestId, result: { action: response.action } });
      }
      if (!prompt.supported) return unavailable;
      const content = checkFormValues(prompt, response.values);
      if (typeof content === "string") return rejected(ERROR_CODES.badRequest, content);
      return () => handler.call(ui(), { requestId, result: { action: "accept", content } });
    }
    if (response.kind === "plan" && prompt.kind === "plan") {
      const handler = ui()?.handlePendingExitPlanMode;
      if (typeof handler !== "function") return unavailable;
      if (response.approved) {
        if (!prompt.actions.includes(response.action)) {
          return rejected(ERROR_CODES.badRequest, "That isn't one of the plan's actions.");
        }
        return () =>
          handler.call(ui(), {
            requestId,
            response: { approved: true, selectedAction: response.action },
          });
      }
      const feedback = response.feedback?.trim();
      return () =>
        handler.call(ui(), {
          requestId,
          response: feedback ? { approved: false, feedback } : { approved: false },
        });
    }
    return rejected(ERROR_CODES.badRequest, "That answer doesn't match this request.");
  }

  async function execute(
    call: () => Promise<unknown>,
    onSettled: (succeeded: boolean) => void,
  ): Promise<RespondOutcome> {
    const attempt: Promise<Attempt> = Promise.resolve()
      .then(call)
      .then(
        (result): Attempt => ({ result }),
        (error: unknown): Attempt => ({ error }),
      );
    // Notify on actual settlement, not timeout: the service keeps the answer guarded until then.
    const finished = attempt.then((outcome) => {
      onSettled(!("error" in outcome));
      return outcome;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const timedOut = new Promise<"timeout">((resolve) => {
      cancel = () => resolve("timeout");
      cancels.add(cancel);
      timer = setTimeout(cancel, timeoutMs);
    });
    const winner = await Promise.race([finished, timedOut]);
    clearTimeout(timer);
    cancels.delete(cancel);
    if (winner === "timeout") {
      void finished.then((late) => {
        if ("error" in late)
          log(`Late prompt answer failed: ${describeError(late.error)}`, "warning");
      });
      return {
        ok: false,
        status: SEND_STATUS.uncertain,
        code: ERROR_CODES.respondUncertain,
        message: "The session didn't confirm your answer in time. It may still apply.",
      };
    }
    if ("error" in winner) {
      log(`Prompt answer failed: ${describeError(winner.error)}`, "warning");
      return rejected(
        ERROR_CODES.respondFailed,
        describeError(winner.error) || "The session didn't accept the answer.",
      );
    }
    if (isRecord(winner.result) && winner.result.success === true) {
      return { ok: true, status: SEND_STATUS.accepted };
    }
    return rejected(ERROR_CODES.promptResolved, RESOLVED_MESSAGE);
  }

  return {
    can,
    prepare,
    execute,
    async readPending(): Promise<unknown> {
      const reader = permissions()?.pendingRequests;
      if (typeof reader !== "function" || !can.permission()) return undefined;
      return reader.call(permissions());
    },
    dispose() {
      for (const cancel of Array.from(cancels)) cancel();
      cancels.clear();
    },
  };
}
