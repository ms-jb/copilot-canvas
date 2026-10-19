// Attention Events: the only moments worth interrupting the user with a push. Everything else
// (routine status changes, progress, a quick turn that said nothing) stays silent: no news is no
// push. An assistant reply is news: it is pushed unless the app is open and focused, which the
// watcher checks (presence), not this file.
import type { WaitingFor } from "../../src/shared/contract.mts";

/** A turn that ran longer than this is a completion worth a push; a quicker one is not. */
export const LONG_TURN_MS = 2 * 60_000;

export type AttentionKind = "decision" | "blocker" | "completion" | "reply";

export type AttentionEvent =
  /** A new pending request: a permission, question, form or plan to approve. */
  | { type: "prompt"; kind?: string }
  /** The session started waiting for the user. */
  | { type: "waiting"; waitingFor?: WaitingFor }
  /** The session reported an error, which ends the turn. */
  | { type: "session-error" }
  /** The turn ended; `durationMs` is null when its start wasn't seen. */
  | { type: "turn-finished"; durationMs: number | null; failed: boolean; replied?: boolean }
  /** An assistant reply arrived outside a turn (one the stream missed, or a late message). */
  | { type: "reply" }
  /** A routine status change: working, a new intent or tool. */
  | { type: "status" };

export interface Attention {
  push: boolean;
  kind: AttentionKind | null;
}

const SILENT: Attention = { push: false, kind: null };
const push = (kind: AttentionKind): Attention => ({ push: true, kind });

/**
 * Whether an event is an Attention Event: a decision waiting on the user, a blocker that stopped
 * work, an assistant reply, or a completion they'd accept (a turn without a reply that ran over two
 * minutes). A turn that ended on an error was already pushed as a blocker. A turn that ends with a
 * reply is one "reply", never also a "completion", however long it ran.
 */
export function classifyAttention(event: AttentionEvent): Attention {
  switch (event.type) {
    case "prompt":
    case "waiting":
      return push("decision");
    case "session-error":
      return push("blocker");
    case "turn-finished":
      if (event.failed) return SILENT;
      if (event.replied) return push("reply");
      return event.durationMs !== null && event.durationMs > LONG_TURN_MS
        ? push("completion")
        : SILENT;
    case "reply":
      return push("reply");
    case "status":
      return SILENT;
  }
}
