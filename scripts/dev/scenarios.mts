import type { PendingPrompt } from "../../src/shared/contract.mts";
import { SCRIPT, samplePermission } from "./fixtures.mts";
import { setPrompts, setStatus, upsert } from "./session.mts";
import type { MockSession, MockSessions } from "./session.mts";

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createScenarios(sessions: MockSessions) {
  // Scripted turns wait here for an answer; a request left alone is "answered elsewhere".
  const waiters = new Map<string, () => void>();
  async function ask(session: MockSession, prompt: PendingPrompt, timeoutMs: number) {
    setPrompts(session, [...session.prompts, prompt]);
    setStatus(session, { phase: "waiting", waitingFor: "permission" });
    await new Promise<void>((done) => {
      const timer = setTimeout(done, timeoutMs);
      waiters.set(prompt.requestId, () => {
        clearTimeout(timer);
        done();
      });
    });
    waiters.delete(prompt.requestId);
    if (session.prompts.some((item) => item.requestId === prompt.requestId)) {
      setPrompts(
        session,
        session.prompts.filter((item) => item.requestId !== prompt.requestId),
      );
    }
  }

  /** One scripted turn: thinking -> (permission request) -> tool -> thinking -> streamed reply -> idle. */
  async function runTurn(session: MockSession, reply: string, tool: string, wait: boolean) {
    setStatus(session, { phase: "working", activity: "thinking" });
    await sleep(1400);
    if (wait) await ask(session, samplePermission(), 20000);
    setStatus(session, { phase: "working", activity: "tool", toolName: tool });
    await sleep(1600);
    setStatus(session, { phase: "working", activity: "thinking" });
    await sleep(800);
    setStatus(session, { phase: "working", activity: "responding" });
    const id = `assistant:mock-${sessions.nextId()}`;
    const timestamp = new Date().toISOString();
    const words = reply.split(/(?<=\s)/);
    for (let end = 3; end < words.length; end += 3) {
      upsert(session, {
        id,
        kind: "assistant",
        text: words.slice(0, end).join(""),
        timestamp,
        streaming: true,
      });
      await sleep(60);
    }
    upsert(session, { id, kind: "assistant", text: reply, timestamp });
    setStatus(session, { phase: "idle" });
  }

  // Turns run one at a time; the live scenario adds a scripted prompt whenever it has been idle a while.
  let queue = Promise.resolve();
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let step = 0;
  function enqueue(session: MockSession, turn: () => Promise<void>) {
    clearTimeout(autoTimer);
    queue = queue.then(turn, turn).then(() => scheduleAuto());
  }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    const live = sessions.peek("live");
    if (!live || live.clients.size === 0) return;
    autoTimer = setTimeout(() => {
      const script = SCRIPT[step % SCRIPT.length]!;
      const wait = step % 3 === 2;
      step += 1;
      enqueue(live, async () => {
        upsert(live, {
          id: `user:auto-${sessions.nextId()}`,
          kind: "user",
          text: script.prompt,
          timestamp: new Date().toISOString(),
        });
        await runTurn(live, script.reply, script.tool, wait);
      });
    }, 7000);
  }

  return {
    enqueue,
    runTurn,
    scheduleAuto,
    resolvePrompt(requestId: string): boolean {
      const waiter = waiters.get(requestId);
      if (!waiter) return false;
      waiter();
      return true;
    },
  };
}

export type MockScenarios = ReturnType<typeof createScenarios>;
