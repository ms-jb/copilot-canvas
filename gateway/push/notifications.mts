import type { PendingPrompt, SessionStatus } from "../../src/shared/contract.mts";

// A status change and its prompt arrive separately; one request should buzz the phone once.
const WAITING_DEDUPE_MS = 3000;

export interface Notice {
  title: string;
  body: string;
  /** Opened on tap: a same-origin path or an http(s) URL. Defaults to the canvas. */
  url?: string;
  /** Notification tag; a notice with its own tag isn't replaced by the next status notice. */
  tag?: string;
}

export interface Presence {
  /** Records whether the app holding this subscription is open and focused right now. */
  report(endpoint: string, focused: boolean, nowMs?: number): void;
  isFocused(endpoint: string, nowMs?: number): boolean;
  forget(endpoint: string): void;
}

/**
 * Which subscribed devices have the app focused, so a push isn't sent to a phone already showing
 * the conversation. A report lapses after `ttlMs`, so a closed or crashed app is notified again.
 */
export function createPresence(ttlMs: number): Presence {
  const until = new Map<string, number>();
  return {
    report(endpoint, focused, now = Date.now()) {
      if (focused) until.set(endpoint, now + ttlMs);
      else until.delete(endpoint);
    },
    isFocused: (endpoint, now = Date.now()) => (until.get(endpoint) ?? -Infinity) > now,
    forget: (endpoint) => void until.delete(endpoint),
  };
}

function waitingBody(kind: string | undefined): string {
  switch (kind) {
    case "permission":
      return "Waiting for your permission.";
    case "question":
    case "input":
      return "Has a question for you.";
    case "form":
    case "elicitation":
      return "Needs a few details from you.";
    case "plan":
      return "Has a plan ready for you to review.";
    default:
      return "Waiting for you.";
  }
}

export interface Notifier {
  /** A (re)connected stream's first event. A new provider run starts from scratch. */
  snapshot(
    generation: string,
    status: SessionStatus,
    prompts: PendingPrompt[],
    nowMs?: number,
  ): Notice | null;
  status(next: SessionStatus, nowMs?: number): Notice | null;
  prompts(list: PendingPrompt[], nowMs?: number): Notice | null;
}

/**
 * Turns the provider's event stream into at most one notice per moment that needs the user: a new
 * pending request (or entering "waiting"), and a finished turn. Reconnecting to the same provider
 * run never repeats a notice.
 */
export function createNotifier(assistantName: string): Notifier {
  let generation: string | null = null;
  let current: SessionStatus | null = null;
  let seen = new Set<string>();
  let lastWaitingAt = -Infinity;

  const waiting = (kind: string | undefined, now: number): Notice | null => {
    if (now - lastWaitingAt < WAITING_DEDUPE_MS) return null;
    lastWaitingAt = now;
    return { title: `${assistantName} needs you`, body: waitingBody(kind) };
  };

  const onPrompts = (list: PendingPrompt[], now: number): Notice | null => {
    const fresh = list.find((prompt) => !seen.has(prompt.requestId));
    seen = new Set(list.map((prompt) => prompt.requestId));
    return fresh ? waiting(fresh.kind, now) : null;
  };

  const onStatus = (next: SessionStatus, now: number): Notice | null => {
    const previous = current;
    current = next;
    if (
      next.phase === "waiting" &&
      !(previous?.phase === "waiting" && previous.waitingFor === next.waitingFor)
    ) {
      return waiting(next.waitingFor, now);
    }
    if (previous?.phase === "working" && next.phase === "idle") {
      return { title: `${assistantName} finished`, body: "Ready for your next step." };
    }
    return null;
  };

  return {
    snapshot(nextGeneration, status, prompts, now = Date.now()) {
      if (nextGeneration !== generation) {
        generation = nextGeneration;
        current = null;
        seen = new Set();
        lastWaitingAt = -Infinity;
      }
      const fromPrompts = onPrompts(prompts, now);
      return onStatus(status, now) ?? fromPrompts;
    },
    status: (next, now = Date.now()) => onStatus(next, now),
    prompts: (list, now = Date.now()) => onPrompts(list, now),
  };
}
