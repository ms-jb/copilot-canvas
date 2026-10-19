import { randomUUID } from "node:crypto";
import type {
  PendingPrompt,
  SessionControls,
  TranscriptEntry,
  ActivityItem,
  ContextState,
  SkillsInfo,
} from "../../src/shared/contract.mts";

export const SESSION_ID = "dev-mock-session";
export const CSRF_TOKEN = "dev-mock-csrf";
export const SCENARIOS = ["live", "empty", "waiting", "busy", "nocontrols", "offline"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const COOKIE = "cc-mock-state";

const MODELS: SessionControls["models"] = [
  {
    id: "model-a",
    name: "Model A",
    reasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    contextTiers: ["default", "long_context"],
    contextTokens: { default: 128000, long_context: 256000 },
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

export const SCRIPT: { prompt: string; tool: string; reply: string }[] = [
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

export function sampleTranscript(): TranscriptEntry[] {
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

export function initialControls(scenario: Scenario): SessionControls {
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

export const SAMPLE_SKILLS: SkillsInfo = {
  available: true,
  skills: [
    {
      name: "review",
      description: "Review the current change for correctness.",
      hint: "files or change",
    },
    { name: "explain", description: "Explain how a module works.", hint: "module name" },
    { name: "test", description: "Find and run relevant tests.", hint: null },
  ],
};

export const SAMPLE_CONTEXT: ContextState = {
  usage: {
    currentTokens: 32000,
    tokenLimit: 128000,
    systemTokens: 8000,
    conversationTokens: 20000,
    toolDefinitionsTokens: 4000,
    compactionThreshold: 102400,
    messages: 7,
  },
  compacting: false,
  actions: { refresh: true },
};

export function sampleActivity(timestamp: string): ActivityItem[] {
  return [
    {
      id: "reasoning:sample",
      kind: "reasoning",
      timestamp,
      text: "I will inspect the helper, then check its boundary cases.",
    },
    {
      id: "tool:sample",
      kind: "tool",
      name: "read_file",
      title: "Inspect duration helper",
      timestamp,
      state: "succeeded",
      durationMs: 182,
      detail: "src/format.ts",
      args: '{"path":"src/format.ts"}',
      result: "Read the helper and its tests.",
    },
  ];
}
// Sample requests for `?state=waiting` and the scripted live loop. Generic, public-safe content.
export function samplePermission(): PendingPrompt {
  return {
    kind: "permission",
    requestId: `mock-permission-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    permission: "command",
    intent: "Run the test suite to check the change before replying.",
    detail: "npm test -- --reporter=dot",
  };
}

export function sampleQuestion(): PendingPrompt {
  return {
    kind: "question",
    requestId: `mock-question-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    question: "Which format should the weekly update use?",
    choices: ["Bulleted summary", "Short paragraph", "Table"],
    allowFreeform: true,
  };
}
