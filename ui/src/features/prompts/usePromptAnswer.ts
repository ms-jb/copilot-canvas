import { useEffect, useRef, useState } from "react";
import { respondToPrompt, type SendContext } from "../../api";
import type { PendingPrompt, PromptResponse } from "../../shared";

interface Failure {
  tone: "error" | "uncertain";
  message: string;
}

interface PromptAnswerOptions {
  prompts: PendingPrompt[];
  context: SendContext | null;
  disabled: boolean;
  onStale: () => void;
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** Submission is only invoked by a user action; mounting or refreshing never answers a prompt. */
export function usePromptAnswer({ prompts, context, disabled, onStale }: PromptAnswerOptions) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const [sending, setSending] = useState<string | null>(null);
  // Set synchronously before any await so a double click can never answer twice.
  const inFlight = useRef(new Set<string>());

  // Forget local bookkeeping for requests the session no longer lists.
  useEffect(() => {
    const live = new Set(prompts.map((prompt) => prompt.requestId));
    setAnswered((set) => {
      const next = new Set([...set].filter((id) => live.has(id)));
      return next.size === set.size ? set : next;
    });
    setFailures((map) => {
      const keys = Object.keys(map).filter((id) => live.has(id));
      return keys.length === Object.keys(map).length
        ? map
        : Object.fromEntries(keys.map((id) => [id, map[id]!]));
    });
  }, [prompts]);

  const answer = async (requestId: string, response: PromptResponse): Promise<void> => {
    if (!context || disabled || inFlight.current.has(requestId)) return;
    inFlight.current.add(requestId);
    setSending(requestId);
    setFailures((map) => without(map, requestId));
    try {
      const outcome = await respondToPrompt(context, requestId, response);
      switch (outcome.kind) {
        case "accepted":
        case "resolved":
          setAnswered((set) => new Set(set).add(requestId));
          break;
        case "stale":
          onStale();
          break;
        case "rejected":
        case "uncertain":
          setFailures((map) => ({
            ...map,
            [requestId]: {
              tone: outcome.kind === "rejected" ? "error" : "uncertain",
              message: outcome.message,
            },
          }));
          break;
      }
    } finally {
      inFlight.current.delete(requestId);
      setSending((value) => (value === requestId ? null : value));
    }
  };

  return { answered, failures, sending, answer };
}
