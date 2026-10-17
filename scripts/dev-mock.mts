// Development-only mock of the extension's provider API, so `vp dev` renders a realistic canvas
// without the Copilot app. Registered with `apply: "serve"`: it never runs in or ships with a build.
//
// Scenarios: add `?state=empty|waiting|busy|nocontrols` to the page URL (default: a live scripted
// loop). DEV_PUBLIC_URL sets the "Open on phone" origin ("off" hides the button).

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite-plus";
import {
  API,
  CONTRACT_VERSION,
  ERROR_CODES,
  HEADERS,
  HTTP_STATUS_BY_CODE,
  IDENTITY_APP,
  LIMITS,
  toPublicOrigin,
  validateControlsPayload,
  validateReloadPayload,
  validateRespondPayload,
  validateSendPayload,
} from "../extension-src/shared/contract.mts";
import type {
  ControlChange,
  PendingPrompt,
  PromptResponse,
  SessionControls,
  SessionStatus,
  TranscriptEntry,
} from "../extension-src/shared/contract.mts";
import { loadConfig } from "../extension-src/shared/config.mts";

const SESSION_ID = "dev-mock-session";
const CSRF_TOKEN = "dev-mock-csrf";
const SCENARIOS = ["live", "empty", "waiting", "busy", "nocontrols"] as const;
type Scenario = (typeof SCENARIOS)[number];
const COOKIE = "cc-mock-state";
const MAX_ENTRIES = 60;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const MODELS: SessionControls["models"] = [
  {
    id: "model-a",
    name: "Model A",
    reasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    contextTiers: ["default", "long_context"],
  },
  {
    id: "model-b",
    name: "Model B",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "high",
    contextTiers: ["default"],
  },
  { id: "model-c", name: "Model C (fast)" },
];

const FORMAT_REPLY = `Here is a small helper. It rounds to whole minutes and pads the minutes when hours are shown:

\`\`\`ts
function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? \`\${hours}h \${String(minutes).padStart(2, "0")}m\` : \`\${minutes}m\`;
}
\`\`\`

- 65 minutes formats as **1h 05m**
- 42 minutes formats as **42m**`;

const SCRIPT: { prompt: string; tool: string; reply: string }[] = [
  {
    prompt: "What makes a good weekly status update?",
    tool: "web_search",
    reply: `Short and skimmable wins. A format that works well:

- **Done** – two or three results, not every task.
- **Next** – what you will finish before the next update.
- **Blocked** – anything you need from someone else, with a name and a date.
- **Risks** – one line each, only if something changed.

Keep it under a minute to read; link out for details instead of pasting them.`,
  },
  {
    prompt: "What did I jot down about the demo yesterday?",
    tool: "read_notes",
    reply: `You left yourself three notes about **Thursday's demo**:

1. Open with the problem, not the feature list.
2. Show the phone layout last, it gets the best reaction.
3. Leave five minutes for questions.

> Rehearse once end to end on Wednesday afternoon.`,
  },
  {
    prompt: "Draft a friendly reminder about the demo.",
    tool: "read_calendar",
    reply: `Here is a short reminder you can send today:

> Hi all, a quick reminder that the demo is on **Thursday at 10:00**. It takes about twenty minutes, with time for questions at the end. Bring anything you would like to see covered!

Want me to make it more formal, or add an agenda?`,
  },
];

function sampleTranscript(): TranscriptEntry[] {
  const now = Date.now();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(16, 4, 0, 0);
  const at = (base: number, minutes: number) => new Date(base + minutes * 60_000).toISOString();
  const y = yesterday.getTime();
  return [
    {
      id: "user:sample-1",
      kind: "user",
      text: "Help me plan tomorrow. I have a demo on Thursday and two reviews to finish.",
      timestamp: at(y, 0),
    },
    {
      id: "assistant:sample-1",
      kind: "assistant",
      timestamp: at(y, 1),
      text: `Here is a plan that keeps the demo safe and still clears the reviews:

1. **Morning** – finish the first review while you are fresh.
2. **Late morning** – outline the demo: problem, walkthrough, questions.
3. **Afternoon** – second review, then a quick dry run of the demo.

If the second review runs long, move it to Wednesday. The demo outline is the one thing that should not slip.`,
    },
    {
      id: "user:sample-2",
      kind: "user",
      text: "Write a tiny function that turns milliseconds into something like 1h 05m.",
      timestamp: at(now, -42),
    },
    { id: "assistant:sample-2", kind: "assistant", timestamp: at(now, -41), text: FORMAT_REPLY },
    {
      id: "assistant:sample-2b",
      kind: "assistant",
      timestamp: at(now, -40),
      text: "I also checked the edge case: anything under a minute rounds to **0m**.",
    },
    {
      id: "user:sample-3",
      kind: "user",
      text: "Thanks. What should a ten minute demo cover?",
      timestamp: at(now, -9),
    },
    {
      id: "assistant:sample-3",
      kind: "assistant",
      timestamp: at(now, -8),
      text: `In ten minutes, aim for one clear story:

- **Why** – the problem in a single sentence.
- **How** – one end-to-end walkthrough, no detours.
- **What's next** – one thing you are asking the room for.

> People remember the walkthrough, not the slides. Spend most of the time there.`,
    },
  ];
}

function initialControls(scenario: Scenario): SessionControls {
  if (scenario === "nocontrols") {
    return {
      available: { mode: false, model: false, reasoningEffort: false, contextTier: false },
      models: [],
    };
  }
  return {
    available: { mode: true, model: true, reasoningEffort: true, contextTier: true },
    mode: "interactive",
    modelId: "model-a",
    reasoningEffort: "medium",
    contextTier: "default",
    models: MODELS,
  };
}

interface MockSession {
  entries: TranscriptEntry[];
  status: SessionStatus;
  controls: SessionControls;
  prompts: PendingPrompt[];
  seq: number;
  clients: Set<ServerResponse>;
}

// Sample requests for `?state=waiting` and the scripted live loop. Generic, public-safe content.
function samplePermission(): PendingPrompt {
  return {
    kind: "permission",
    requestId: `mock-permission-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    permission: "command",
    intent: "Run the test suite to check the change before replying.",
    detail: "npm test -- --reporter=dot",
  };
}

function sampleQuestion(): PendingPrompt {
  return {
    kind: "question",
    requestId: `mock-question-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    question: "Which format should the weekly update use?",
    choices: ["Bulleted summary", "Short paragraph", "Table"],
    allowFreeform: true,
  };
}

/** Mirrors the host's checks: an answer has to fit the request it answers. */
function fits(prompt: PendingPrompt, response: PromptResponse): boolean {
  if (prompt.kind !== response.kind) return false;
  if (prompt.kind === "question" && response.kind === "question") {
    return response.freeform ? prompt.allowFreeform : prompt.choices.includes(response.answer);
  }
  if (prompt.kind === "plan" && response.kind === "plan" && response.approved) {
    return prompt.actions.includes(response.action);
  }
  return true;
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
    controls: initialControls(scenario),
    prompts,
    seq: 0,
    clients: new Set(),
  };
}

export function devMock(repoRoot: string): Plugin {
  const config = loadConfig(repoRoot);
  const generation = `dev-mock-${randomUUID().slice(0, 8)}`;
  const sessions = new Map<Scenario, MockSession>();
  let counter = 0;

  const get = (scenario: Scenario) => {
    let session = sessions.get(scenario);
    if (!session) sessions.set(scenario, (session = createSession(scenario)));
    return session;
  };

  function broadcast(session: MockSession, name: string, data: Record<string, unknown>) {
    session.seq += 1;
    const frame = `event: ${name}\ndata: ${JSON.stringify({ seq: session.seq, ...data })}\n\n`;
    for (const client of session.clients) client.write(frame);
  }
  function upsert(session: MockSession, entry: TranscriptEntry) {
    const index = session.entries.findIndex((existing) => existing.id === entry.id);
    if (index >= 0) session.entries[index] = entry;
    else session.entries.push(entry);
    if (session.entries.length > MAX_ENTRIES)
      session.entries.splice(0, session.entries.length - MAX_ENTRIES);
    broadcast(session, "entry", { entry });
  }
  function setStatus(session: MockSession, status: SessionStatus) {
    session.status = status;
    broadcast(session, "status", { status });
  }
  function setPrompts(session: MockSession, prompts: PendingPrompt[]) {
    session.prompts = prompts;
    broadcast(session, "prompts", { prompts });
  }

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
    const id = `assistant:mock-${++counter}`;
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
    const live = sessions.get("live");
    if (!live || live.clients.size === 0) return;
    autoTimer = setTimeout(() => {
      const script = SCRIPT[step % SCRIPT.length]!;
      const wait = step % 3 === 2;
      step += 1;
      enqueue(live, async () => {
        upsert(live, {
          id: `user:auto-${++counter}`,
          kind: "user",
          text: script.prompt,
          timestamp: new Date().toISOString(),
        });
        await runTurn(live, script.reply, script.tool, wait);
      });
    }, 7000);
  }

  function applyChange(controls: SessionControls, change: ControlChange): string | null {
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

  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
  function error(res: ServerResponse, code: string, message: string) {
    json(res, HTTP_STATUS_BY_CODE[code] ?? 500, { ok: false, code, message });
  }
  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > LIMITS.maxBodyBytes) return undefined;
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return undefined;
    }
  }
  function scenarioOf(req: IncomingMessage): Scenario {
    const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z]+)`).exec(req.headers.cookie ?? "");
    const value = match?.[1] as Scenario | undefined;
    return value && SCENARIOS.includes(value) ? value : "live";
  }
  // Writes are pinned like the real provider: matching generation and CSRF token required.
  function checkWrite(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.headers[HEADERS.generation] !== generation) {
      error(res, ERROR_CODES.staleProvider, "The provider was restarted.");
      return false;
    }
    if (req.headers[HEADERS.csrf] !== CSRF_TOKEN) {
      error(res, ERROR_CODES.forbidden, "Forbidden.");
      return false;
    }
    return true;
  }

  async function handle(route: string, req: IncomingMessage, res: ServerResponse) {
    const session = get(scenarioOf(req));
    const method = req.method ?? "GET";
    const expected =
      route === API.send || route === API.controls || route === API.respond || route === API.reload
        ? "POST"
        : "GET";
    if (method !== expected) return error(res, ERROR_CODES.methodNotAllowed, "Method not allowed.");

    switch (route) {
      case API.identity:
        return json(res, 200, { app: IDENTITY_APP, contractVersion: CONTRACT_VERSION, generation });
      case API.bootstrap:
        return json(res, 200, {
          contractVersion: CONTRACT_VERSION,
          generation,
          sessionId: SESSION_ID,
          csrfToken: CSRF_TOKEN,
          config: {
            assistantName: config.assistantName,
            description: config.description,
            defaultView: config.defaultView,
            sourceDir: repoRoot,
          },
          snapshot: { entries: session.entries, status: session.status, prompts: session.prompts },
          controls: session.controls,
        });
      case API.share: {
        const raw = process.env.DEV_PUBLIC_URL;
        const publicUrl =
          raw === "off" ? null : (toPublicOrigin(raw) ?? "https://example.devtunnels.ms");
        return json(res, 200, { publicUrl });
      }
      case API.events: {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(
          `event: snapshot\ndata: ${JSON.stringify({
            seq: session.seq,
            generation,
            snapshot: {
              entries: session.entries,
              status: session.status,
              prompts: session.prompts,
            },
            controls: session.controls,
          })}\n\n`,
        );
        session.clients.add(res);
        const keepalive = setInterval(() => res.write(": keepalive\n\n"), LIMITS.keepaliveMs);
        req.on("close", () => {
          clearInterval(keepalive);
          session.clients.delete(res);
        });
        if (session === sessions.get("live") && session.status.phase === "idle") scheduleAuto();
        return;
      }
      case API.send: {
        if (!checkWrite(req, res)) return;
        const parsed = validateSendPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        const messageId = `mock-msg-${++counter}`;
        json(res, 200, {
          ok: true,
          status: "accepted",
          requestId: parsed.value.requestId,
          messageId,
        });
        const { text, requestId } = parsed.value;
        enqueue(session, async () => {
          upsert(session, {
            id: `user:${messageId}`,
            kind: "user",
            text,
            timestamp: new Date().toISOString(),
            requestId,
          });
          const reply = `This is a **preview**, so your message was not sent anywhere. In a real session, Copilot would answer here.\n\nYou wrote:\n\n> ${text.split("\n").join("\n> ")}`;
          await runTurn(session, reply, "read_notes", false);
        });
        return;
      }
      case API.controls: {
        if (!checkWrite(req, res)) return;
        const parsed = validateControlsPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        await sleep(350);
        const next = structuredClone(session.controls);
        const failure = applyChange(next, parsed.value.change);
        if (failure) return error(res, failure, "That setting can't be changed here.");
        session.controls = next;
        broadcast(session, "controls", { controls: next });
        return json(res, 200, { ok: true, controls: next });
      }
      case API.respond: {
        if (!checkWrite(req, res)) return;
        const parsed = validateRespondPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        const { requestId, response } = parsed.value;
        const prompt = session.prompts.find((item) => item.requestId === requestId);
        if (!prompt) {
          return error(res, ERROR_CODES.promptResolved, "This request is no longer waiting.");
        }
        if (!fits(prompt, response)) {
          return error(res, ERROR_CODES.badRequest, "That answer doesn't match this request.");
        }
        await sleep(300);
        const remaining = session.prompts.filter((item) => item.requestId !== requestId);
        setPrompts(session, remaining);
        json(res, 200, { ok: true, status: "accepted" });
        const waiter = waiters.get(requestId);
        if (waiter) return waiter();
        if (remaining.length === 0) {
          enqueue(session, async () => {
            const reply =
              "Thanks, that's all I needed. This is a **preview**, so nothing actually ran.";
            await runTurn(session, reply, "read_notes", false);
          });
        }
        return;
      }
      case API.reload: {
        if (!checkWrite(req, res)) return;
        const parsed = validateReloadPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        // The preview has no extensions to reload, so it only acknowledges.
        return json(res, 200, { ok: true, status: "scheduled" });
      }
    }
  }

  const routes = new Set<string>(Object.values(API));
  return {
    name: "copilot-canvas-dev-mock",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        const route = /(?:^|\/)(api\/[a-z]+)$/.exec(pathname)?.[1];
        if (!route || !routes.has(route)) return next();
        handle(route, req, res).catch(() => {
          if (!res.headersSent) error(res, ERROR_CODES.internal, "Mock failed.");
        });
      });
    },
    // The page sends no Referer, so the scenario travels from `?state=` to the API as a cookie.
    transformIndexHtml: () => [
      {
        tag: "script",
        injectTo: "head-prepend",
        children: `(()=>{const s=new URLSearchParams(location.search).get("state");document.cookie="${COOKIE}="+(s&&/^[a-z]+$/.test(s)?s:"")+"; path=/; SameSite=Strict";})();`,
      },
    ],
  };
}
