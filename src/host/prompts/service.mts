// Session events/read-back are authoritative. Only explicit user decisions reach the adapter.
import { ERROR_CODES, LIMITS } from "../../shared/contract.mts";
import type { PendingPrompt, PromptResponse } from "../../shared/contract.mts";
import type { SessionEventLike } from "../../shared/transcript.mts";
import type { Logger } from "../logging.mts";
import { describePermission, describePlan, describeQuestion, isRecord } from "./descriptions.mts";
import { describeForm } from "./form-schema.mts";
import {
  createPromptsRpcAdapter,
  describeError,
  rejected,
  RESOLVED_MESSAGE,
} from "./rpc-adapter.mts";
import type { PromptsRpcLike, RespondOutcome } from "./rpc-adapter.mts";

export interface PromptService {
  /** Resolves once the first read-back of pending permission requests settled. */
  ready: Promise<void>;
  /** Current answerable prompts, oldest first. */
  list(): PendingPrompt[];
  subscribe(listener: (prompts: PendingPrompt[]) => void): () => void;
  applyEvent(event: SessionEventLike): void;
  /** Re-reads pending permission requests (start, reconnect, idle). Cheap to call often. */
  refresh(): void;
  respond(requestId: string, response: PromptResponse): Promise<RespondOutcome>;
  dispose(): void;
}

export interface PromptServiceOptions {
  log?: Logger;
  timeoutMs?: number;
  /** Minimum time between two read-backs of pending permission requests. */
  refreshIntervalMs?: number;
}

interface Tracked {
  prompt: PendingPrompt;
  /** Monotonic arrival mark, compared against read-back start marks. */
  mark: number;
}

export function createPromptService(
  session: { readonly rpc?: PromptsRpcLike },
  {
    log = () => {},
    timeoutMs = LIMITS.respondTimeoutMs,
    refreshIntervalMs = 1000,
  }: PromptServiceOptions = {},
): PromptService {
  const rpc = createPromptsRpcAdapter(session, { log, timeoutMs });
  const { can } = rpc;
  const pending = new Map<string, Tracked>();
  const settled = new Set<string>();
  const answering = new Set<string>();
  const listeners = new Set<(prompts: PendingPrompt[]) => void>();
  let mark = 0;
  let disposed = false;
  let refreshing = false;
  let refreshQueued = false;
  let lastRefreshAt = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function list(): PendingPrompt[] {
    return [...pending.values()]
      .slice(-LIMITS.maxPrompts)
      .map((tracked) => structuredClone(tracked.prompt));
  }
  function notify(): void {
    if (disposed) return;
    const prompts = list();
    for (const listener of Array.from(listeners)) {
      try {
        listener(prompts);
      } catch (error) {
        log(`Prompt listener failed: ${describeError(error)}`, "warning");
      }
    }
  }
  function settle(requestId: string): void {
    settled.add(requestId);
    if (settled.size > 500) settled.delete(settled.values().next().value as string);
  }
  function add(prompt: PendingPrompt): void {
    if (disposed || settled.has(prompt.requestId)) return;
    const existing = pending.get(prompt.requestId);
    mark += 1;
    pending.set(prompt.requestId, { prompt, mark: existing?.mark ?? mark });
    notify();
  }
  function drop(requestId: string): void {
    settle(requestId);
    if (pending.delete(requestId)) notify();
  }
  function dropWhere(test: (prompt: PendingPrompt) => boolean): void {
    let changed = false;
    for (const [requestId, tracked] of pending) {
      if (!test(tracked.prompt)) continue;
      settle(requestId);
      pending.delete(requestId);
      changed = true;
    }
    if (changed) notify();
  }

  function applyEvent(event: SessionEventLike): void {
    if (disposed || !event || typeof event.type !== "string") return;
    const data = isRecord(event.data) ? event.data : {};
    const requestId =
      typeof data.requestId === "string" && data.requestId.length > 0 ? data.requestId : null;
    const createdAt =
      typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
    switch (event.type) {
      case "permission.requested":
        if (!requestId || !can.permission()) return;
        // Already decided by a hook: nothing to ask.
        if (data.resolvedByHook === true) return settle(requestId);
        return add(
          describePermission(requestId, createdAt, data.promptRequest ?? data.permissionRequest),
        );
      case "user_input.requested":
        if (requestId && can.question()) add(describeQuestion(requestId, createdAt, data));
        return;
      case "elicitation.requested":
        if (requestId && can.form()) add(describeForm(requestId, createdAt, data));
        return;
      case "exit_plan_mode.requested":
        if (requestId && can.plan()) add(describePlan(requestId, createdAt, data));
        return;
      case "permission.completed":
      case "user_input.completed":
      case "elicitation.completed":
      case "exit_plan_mode.completed":
        if (requestId) drop(requestId);
        return;
      case "session.shutdown":
        if (!event.agentId) dropWhere(() => true);
        return;
      case "session.idle":
      case "abort":
        // A finished turn can't still be asking; permissions are re-checked against the session.
        if (event.agentId) return;
        dropWhere((prompt) => prompt.kind !== "permission");
        refresh();
        return;
      default:
        return;
    }
  }

  async function readPending(): Promise<void> {
    if (!can.list() || !can.permission()) return;
    const startMark = mark;
    let result: unknown;
    try {
      result = await rpc.readPending();
    } catch (error) {
      log(`Could not read pending permission requests: ${describeError(error)}`, "warning");
      return;
    }
    if (disposed) return;
    const items = isRecord(result) && Array.isArray(result.items) ? result.items : [];
    const live = new Set<string>();
    let changed = false;
    for (const item of items) {
      if (!isRecord(item) || typeof item.requestId !== "string" || !item.requestId) continue;
      live.add(item.requestId);
      if (pending.has(item.requestId) || settled.has(item.requestId)) continue;
      mark += 1;
      const prompt = describePermission(item.requestId, new Date().toISOString(), item.request);
      pending.set(item.requestId, { prompt, mark });
      changed = true;
    }
    // Keep requests arriving during this read and answers still in flight.
    for (const [requestId, tracked] of pending) {
      if (tracked.prompt.kind !== "permission" || tracked.mark > startMark) continue;
      if (live.has(requestId) || answering.has(requestId)) continue;
      settle(requestId);
      pending.delete(requestId);
      changed = true;
    }
    if (changed) notify();
  }
  function refresh(): void {
    if (disposed || !can.list()) return;
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    const wait = lastRefreshAt + refreshIntervalMs - Date.now();
    if (wait > 0) {
      if (refreshTimer === null) {
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          refresh();
        }, wait);
      }
      return;
    }
    refreshing = true;
    lastRefreshAt = Date.now();
    void runRefresh();
  }
  async function runRefresh(): Promise<void> {
    try {
      await readPending();
    } finally {
      refreshing = false;
      if (refreshQueued && !disposed) {
        refreshQueued = false;
        refresh();
      }
    }
  }
  async function respond(requestId: string, response: PromptResponse): Promise<RespondOutcome> {
    if (disposed) return rejected(ERROR_CODES.notConnected, "The session is no longer connected.");
    const tracked = pending.get(requestId);
    if (!tracked) return rejected(ERROR_CODES.promptResolved, RESOLVED_MESSAGE);
    // Synchronous guard: double taps and other clients cannot answer twice, even after timeout.
    if (answering.has(requestId)) {
      return rejected(ERROR_CODES.duplicateRequest, "This request is already being answered.");
    }
    const call = rpc.prepare(tracked.prompt, response);
    if (typeof call !== "function") return call;
    answering.add(requestId);
    return rpc.execute(call, (succeeded) => {
      answering.delete(requestId);
      // success:false also means no longer waiting (answered elsewhere or expired).
      if (succeeded) drop(requestId);
    });
  }
  function subscribe(listener: (prompts: PendingPrompt[]) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    rpc.dispose();
    pending.clear();
    listeners.clear();
  }
  let ready: Promise<void> = Promise.resolve();
  if (can.list()) {
    refreshing = true;
    lastRefreshAt = Date.now();
    ready = runRefresh();
  }
  return { ready, list, subscribe, applyEvent, refresh, respond, dispose };
}
