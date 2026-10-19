import type {
  PendingPrompt,
  SessionStatus,
  Snapshot,
  TranscriptEntry,
} from "../../src/shared/contract.mts";
import { classifyAttention } from "./attention.mts";
import type { AttentionEvent } from "./attention.mts";
import { previewText } from "./preview.mts";

// A status change and its prompt arrive separately; one request should buzz the phone once.
const WAITING_DEDUPE_MS = 3000;
const PREVIEW_MAX_CHARS = 160;

export interface Notice {
  title: string;
  body: string;
  /** Opened on tap: a same-origin path or an http(s) URL. Defaults to the canvas. */
  url?: string;
  /** Notification tag; a notice with its own tag isn't replaced by the next status notice. */
  tag?: string;
}

/** Where a tap on a reply notice lands: the chat. */
export const CHAT_URL = "/#/chat";

export interface Presence {
  /** Records whether the app holding this subscription is open and focused right now. */
  report(endpoint: string, focused: boolean, nowMs?: number): void;
  isFocused(endpoint: string, nowMs?: number): boolean;
  hasFocused(nowMs?: number): boolean;
  forget(endpoint: string): void;
}

/**
 * Which subscribed devices have the app focused, so a push isn't sent to a phone already showing
 * the conversation. A report lapses after `ttlMs`, so a closed or crashed app is notified again.
 */
export function createPresence(ttlMs: number): Presence {
  const until = new Map<string, number>();
  const focusedNow = (now = Date.now()) =>
    [...until.values()].some((focusedUntil) => focusedUntil > now);
  return {
    report(endpoint, focused, now = Date.now()) {
      if (focused) until.set(endpoint, now + ttlMs);
      else until.delete(endpoint);
    },
    isFocused: (endpoint, now = Date.now()) => (until.get(endpoint) ?? -Infinity) > now,
    hasFocused: focusedNow,
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

/** The parts of a stream's first event the notifier reads. */
export type StreamSnapshot = Pick<Snapshot, "status"> &
  Partial<Pick<Snapshot, "prompts" | "entries">>;

export interface Notifier {
  /** A (re)connected stream's first event. A new provider run starts from scratch. */
  snapshot(generation: string, snapshot: StreamSnapshot, nowMs?: number): Notice | null;
  status(next: SessionStatus, nowMs?: number): Notice | null;
  prompts(list: PendingPrompt[], nowMs?: number): Notice | null;
  entry(entry: TranscriptEntry): Notice | null;
}

// Ids remembered per provider run, so a reconnect or a repeated event never pushes twice.
const MAX_REMEMBERED = 200;
const remember = <T,>(map: Map<string, T>, id: string, value: T) => {
  map.delete(id);
  map.set(id, value);
  if (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value as string);
};

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const replyTag = (id: string) => `reply-${id.replace(/[^\w-]/g, "_")}`.slice(0, 64);

function replyPreview(text: string): string {
  const preview = previewText(text, PREVIEW_MAX_CHARS);
  return preview || "Open the canvas to read the reply.";
}

/**
 * Turns the provider's event stream into a notice only for Attention Events (see attention.mts):
 * a new pending request or entering "waiting" (a decision), a session error (a blocker), an
 * assistant reply (one notice per turn, for its last reply) or a reply-less turn that ran over two
 * minutes (a completion). Routine status changes and progress stay silent. Reconnecting to the
 * same run never repeats one. Whether the app is open and focused is the watcher's call
 * (presence), so a notice here only says what would be worth sending.
 */
export function createNotifier(assistantName: string): Notifier {
  let generation: string | null = null;
  let current: SessionStatus | null = null;
  let seen = new Set<string>();
  let errors = new Map<string, true>();
  let replies = new Map<string, true>();
  let lastWaitingAt = -Infinity;
  // When the current turn started (null when its start wasn't seen) and whether it hit an error.
  let turnStartedAt: number | null = null;
  let turnFailed = false;
  let turnReply: { id: string; preview: string } | null = null;

  const pushes = (event: AttentionEvent) => classifyAttention(event).push;

  const decision = (
    event: Extract<AttentionEvent, { type: "prompt" | "waiting" }>,
    now: number,
  ): Notice | null => {
    if (!pushes(event) || now - lastWaitingAt < WAITING_DEDUPE_MS) return null;
    lastWaitingAt = now;
    const kind = event.type === "prompt" ? event.kind : event.waitingFor;
    return { title: `${assistantName} needs you`, body: waitingBody(kind) };
  };

  const onPrompts = (list: PendingPrompt[], now: number): Notice | null => {
    const fresh = list.find((prompt) => !seen.has(prompt.requestId));
    seen = new Set(list.map((prompt) => prompt.requestId));
    return fresh ? decision({ type: "prompt", kind: fresh.kind }, now) : null;
  };

  const onStatus = (next: SessionStatus, now: number): Notice | null => {
    const previous = current;
    current = next;
    if (previous?.phase === "idle" && next.phase !== "idle") {
      turnStartedAt = now;
      turnFailed = false;
      turnReply = null;
    }
    if (
      next.phase === "waiting" &&
      !(previous?.phase === "waiting" && previous.waitingFor === next.waitingFor)
    ) {
      return decision({ type: "waiting", waitingFor: next.waitingFor }, now);
    }
    if (next.phase !== "idle") return null;
    const durationMs = turnStartedAt === null ? null : now - turnStartedAt;
    const finished = previous?.phase === "working";
    const failed = turnFailed;
    const reply = turnReply;
    turnStartedAt = null;
    turnFailed = false;
    turnReply = null;
    if (!finished) return null;
    const event: AttentionEvent = { type: "turn-finished", durationMs, failed, replied: !!reply };
    if (!pushes(event)) return null;
    if (reply) return replyNotice(reply);
    return {
      title: `${assistantName} finished`,
      body: `Done after ${duration(durationMs ?? 0)}. Ready for your next step.`,
    };
  };

  const replyNotice = (reply: { id: string; preview: string }): Notice => ({
    title: `${assistantName} replied`,
    body: reply.preview,
    tag: replyTag(reply.id),
    url: CHAT_URL,
  });

  const onEntry = (entry: TranscriptEntry): Notice | null => {
    if (entry.kind === "assistant") {
      // `replies` holds every settled reply seen, pushed or not, so a reconnect repeats nothing. A
      // streamed reply arrives first as a few words and again whole when it settles: the latest
      // text is the preview.
      if (replies.has(entry.id)) return null;
      if (!entry.streaming) remember(replies, entry.id, true);
      const reply = { id: entry.id, preview: replyPreview(entry.text) };
      // Between turns, a settled reply is news on its own; one still streaming belongs to the turn
      // that is about to start.
      if (current?.phase === "idle" && !entry.streaming && pushes({ type: "reply" })) {
        return replyNotice(reply);
      }
      turnReply = reply;
      return null;
    }
    if (entry.kind !== "error" || errors.has(entry.id)) return null;
    remember(errors, entry.id, true);
    turnFailed = true;
    if (!pushes({ type: "session-error" })) return null;
    return {
      title: `${assistantName} is blocked`,
      body: "Work stopped on an error. Open the canvas to see it.",
      tag: "blocker",
    };
  };

  return {
    snapshot(nextGeneration, { status, prompts = [], entries = [] }, now = Date.now()) {
      // A new run's history is recorded without pushes; on the same run, anything that changed
      // while the stream was down is reported once.
      const fresh = nextGeneration !== generation;
      if (fresh) {
        generation = nextGeneration;
        current = null;
        seen = new Set();
        errors = new Map();
        replies = new Map();
        lastWaitingAt = -Infinity;
        turnStartedAt = null;
        turnFailed = false;
        turnReply = null;
      }
      let missed: Notice | null = null;
      for (const entry of entries) {
        if (fresh && entry.kind === "error") remember(errors, entry.id, true);
        else if (fresh && entry.kind === "assistant") remember(replies, entry.id, true);
        else missed = onEntry(entry) ?? missed;
      }
      const fromPrompts = onPrompts(prompts, now);
      return onStatus(status, now) ?? fromPrompts ?? missed;
    },
    status: (next, now = Date.now()) => onStatus(next, now),
    prompts: (list, now = Date.now()) => onPrompts(list, now),
    entry: onEntry,
  };
}
