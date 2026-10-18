import type { ServerResponse } from "node:http";
import { ERROR_CODES, QUEUE_LIMITS, pruneActivity } from "../../src/shared/contract.mts";
import type {
  ControlChange,
  PendingPrompt,
  PromptResponse,
  SessionControls,
  SessionStatus,
  TranscriptEntry,
  ActivityItem,
  ContextState,
} from "../../src/shared/contract.mts";
import {
  SCRIPT,
  initialControls,
  samplePermission,
  sampleQuestion,
  sampleTranscript,
  sampleActivity,
  SAMPLE_CONTEXT,
} from "./fixtures.mts";
import type { Scenario } from "./fixtures.mts";

const MAX_ENTRIES = 60;

export interface MockSession {
  entries: TranscriptEntry[];
  status: SessionStatus;
  controls: SessionControls;
  prompts: PendingPrompt[];
  activity: ActivityItem[];
  context: ContextState;
  seq: number;
  clients: Set<ServerResponse>;
  queued: { id: string; requestId: string; text: string; deliver: (text: string) => void }[];
  removedRequestIds: string[];
}

function createSession(scenario: Scenario): MockSession {
  const entries = scenario === "empty" ? [] : sampleTranscript();
  let status: SessionStatus = { phase: "idle" };
  const prompts: PendingPrompt[] = [];
  if (scenario === "waiting") {
    status = { phase: "waiting", waitingFor: "permission" };
    prompts.push(samplePermission(), sampleQuestion());
  }
  if (scenario === "busy") {
    status = { phase: "working", activity: "responding" };
    entries.push(
      {
        id: "user:busy",
        kind: "user",
        text: SCRIPT[1]!.prompt,
        timestamp: new Date().toISOString(),
      },
      {
        id: "assistant:busy",
        kind: "assistant",
        text: SCRIPT[1]!.reply.slice(0, 160),
        timestamp: new Date().toISOString(),
        streaming: true,
      },
    );
  }
  return {
    entries,
    status,
    activity: scenario === "empty" ? [] : sampleActivity(entries.at(-1)!.timestamp),
    context: structuredClone(SAMPLE_CONTEXT),
    controls: initialControls(scenario),
    prompts,
    seq: 0,
    clients: new Set(),
    queued: [],
    removedRequestIds: [],
  };
}

export function createSessions() {
  const sessions = new Map<Scenario, MockSession>();
  let counter = 0;
  return {
    get(scenario: Scenario) {
      let session = sessions.get(scenario);
      if (!session) sessions.set(scenario, (session = createSession(scenario)));
      return session;
    },
    peek: (scenario: Scenario) => sessions.get(scenario),
    nextId: () => ++counter,
  };
}

export type MockSessions = ReturnType<typeof createSessions>;

export function broadcast(session: MockSession, name: string, data: Record<string, unknown>) {
  session.seq += 1;
  const frame = `event: ${name}\ndata: ${JSON.stringify({ seq: session.seq, ...data })}\n\n`;
  for (const client of session.clients) client.write(frame);
}

export function upsert(session: MockSession, entry: TranscriptEntry) {
  const index = session.entries.findIndex((existing) => existing.id === entry.id);
  if (index >= 0) session.entries[index] = entry;
  else session.entries.push(entry);
  if (session.entries.length > MAX_ENTRIES)
    session.entries.splice(0, session.entries.length - MAX_ENTRIES);
  broadcast(session, "entry", { entry });
  if (entry.kind === "user") session.activity = pruneActivity(session.activity, entry.timestamp);
}

export function setStatus(session: MockSession, status: SessionStatus) {
  session.status = status;
  broadcast(session, "status", { status });
  if (status.phase === "idle") {
    const next = session.queued.shift();
    if (next) {
      publishQueue(session);
      next.deliver(next.text);
    }
  }
}

export const queueState = (session: MockSession) => ({
  removedRequestIds: session.removedRequestIds,
  items: session.queued.slice(0, QUEUE_LIMITS.maxItems).map(({ id, requestId, text }) => ({
    id,
    requestId,
    text: text.slice(0, QUEUE_LIMITS.maxTextChars),
    kind: "message" as const,
    ...(text.length > QUEUE_LIMITS.maxTextChars ? { truncated: true } : {}),
  })),
});
export const publishQueue = (session: MockSession) =>
  broadcast(session, "queue", { queue: queueState(session) });

export function showActivity(session: MockSession, item: ActivityItem) {
  const index = session.activity.findIndex((existing) => existing.id === item.id);
  if (index < 0) session.activity.push(item);
  else session.activity[index] = item;
  session.activity = session.activity.slice(-30);
  broadcast(session, "activity", { item });
}

export function setPrompts(session: MockSession, prompts: PendingPrompt[]) {
  session.prompts = prompts;
  broadcast(session, "prompts", { prompts });
}

/** Mirrors the host's checks: an answer has to fit the request it answers. */
export function fits(prompt: PendingPrompt, response: PromptResponse): boolean {
  if (prompt.kind !== response.kind) return false;
  if (prompt.kind === "question" && response.kind === "question") {
    return response.freeform ? prompt.allowFreeform : prompt.choices.includes(response.answer);
  }
  if (prompt.kind === "plan" && response.kind === "plan" && response.approved) {
    return prompt.actions.includes(response.action);
  }
  return true;
}

export function applyChange(controls: SessionControls, change: ControlChange): string | null {
  if ("mode" in change) {
    if (!controls.available.mode) return ERROR_CODES.controlUnavailable;
    controls.mode = change.mode;
  } else if ("modelId" in change) {
    const model = controls.models.find((option) => option.id === change.modelId);
    if (!controls.available.model) return ERROR_CODES.controlUnavailable;
    if (!model) return ERROR_CODES.badRequest;
    controls.modelId = model.id;
    if (!model.reasoningEfforts?.includes(controls.reasoningEffort ?? "")) {
      controls.reasoningEffort = model.defaultReasoningEffort;
    }
    if (!model.contextTiers?.includes(controls.contextTier ?? "default"))
      controls.contextTier = "default";
  } else if ("reasoningEffort" in change) {
    if (!controls.available.reasoningEffort) return ERROR_CODES.controlUnavailable;
    controls.reasoningEffort = change.reasoningEffort;
  } else {
    if (!controls.available.contextTier) return ERROR_CODES.controlUnavailable;
    controls.contextTier = change.contextTier;
  }
  return null;
}
