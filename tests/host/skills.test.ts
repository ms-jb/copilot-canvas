import { expect, it, vi } from "vite-plus/test";
import { createSessionBridge } from "../../src/host/bridge.mts";
import { createSkillCatalog, slashWords } from "../../src/host/skills/catalog.mts";
import { ERROR_CODES, SKILL_LIMITS, validateSkills } from "../../src/shared/contract.mts";
import { fakeSession } from "./fixtures";

const command = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `About ${name}`,
  kind: "skill",
  allowDuringAgentExecution: false,
  ...extra,
});

it("distinguishes malformed or timed-out catalogs from an available empty list", async () => {
  for (const list of [async () => ({}), () => new Promise<unknown>(() => {})]) {
    expect(await createSkillCatalog({ commands: { list } }, { timeoutMs: 5 }).list()).toEqual({
      available: false,
      skills: [],
    });
  }
  expect(
    await createSkillCatalog({ commands: { list: async () => ({ commands: [] }) } }).list(),
  ).toEqual({ available: true, skills: [] });
});

it("lists the session's skill commands in its order, deduped, clipped and without builtins", async () => {
  const list = vi.fn(async () => ({
    commands: [
      command("grill-me", { input: { hint: "a plan\nor\tdecision" } }),
      { ...command("compact"), kind: "builtin" },
      command("Grill-Me", { description: "A shadowed copy" }),
      command("bad name"),
      command("plugin:review", {
        description: `Line one\nline two ${"x".repeat(400)}`,
        input: { hint: "Instructions for the skill" },
      }),
      { kind: "skill", description: "no name" },
    ],
  }));
  const info = await createSkillCatalog({ commands: { list } }).list();
  expect(list).toHaveBeenCalledWith({
    includeBuiltins: false,
    includeSkills: true,
    includeClientCommands: false,
  });
  expect(info.available).toBe(true);
  expect(info.skills.map((skill) => skill.name)).toEqual(["grill-me", "plugin:review"]);
  expect(info.skills[0]).toEqual({
    name: "grill-me",
    description: "About grill-me",
    hint: "a plan or decision",
  });
  const long = info.skills[1]!.description;
  expect(long).toHaveLength(SKILL_LIMITS.maxDescription);
  expect(long.startsWith("Line one line two x")).toBe(true);
  expect(long.endsWith("…")).toBe(true);
  // The session's generic placeholder hint is dropped; a skill-specific one is kept.
  expect(info.skills[1]!.hint).toBeNull();
  expect(validateSkills(info)).toBe(true);
});

it("falls back to skills.list for user-invocable, enabled skills under their command names", async () => {
  const skills = {
    list: async () => ({
      skills: [
        {
          name: "pdf",
          commandName: "docs:pdf",
          description: "PDFs",
          userInvocable: true,
          enabled: true,
          argumentHint: "a file",
        },
        { name: "hidden", description: "Model only", userInvocable: false, enabled: true },
        { name: "off", description: "Disabled", userInvocable: true, enabled: false },
      ],
    }),
  };
  expect(await createSkillCatalog({ skills }).list()).toEqual({
    available: true,
    skills: [{ name: "docs:pdf", description: "PDFs", hint: "a file" }],
  });
});

it("caps the list, caches it briefly and never caches a failure", async () => {
  let time = 0;
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("not ready"))
    .mockResolvedValue({
      commands: Array.from({ length: SKILL_LIMITS.maxSkills + 5 }, (_, at) => command(`s${at}`)),
    });
  const catalog = createSkillCatalog({ commands: { list } }, { ttlMs: 1000, now: () => time });
  expect(await catalog.list()).toEqual({ available: false, skills: [] });
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  expect(first).toBe(second);
  expect(first.skills).toHaveLength(SKILL_LIMITS.maxSkills);
  time = 999;
  await catalog.list();
  expect(list).toHaveBeenCalledTimes(2);
  time = 1000;
  await catalog.list();
  expect(list).toHaveBeenCalledTimes(3);
  expect(await createSkillCatalog(undefined).list()).toEqual({ available: false, skills: [] });
});

function skillSession(
  invoke: (params: { name: string; input?: string }) => Promise<unknown>,
  names = ["grill-me"],
) {
  const commands = {
    list: async () => ({ commands: names.map((name) => command(name)) }),
    invoke: vi.fn(invoke),
  };
  const send = vi.fn(async (_options: Record<string, unknown>) => "message-1");
  return { session: { ...fakeSession({ commands }), send }, send, invoke: commands.invoke };
}

it("sends a listed skill as the session expands it, showing the typed command", async () => {
  const { session, send, invoke } = skillSession(async (params) => ({
    kind: "agent-prompt",
    prompt: `Run ${params.name} with ${params.input}`,
    displayPrompt: `/${params.name} ${params.input}`,
  }));
  const bridge = createSessionBridge(session);
  expect(await bridge.send("  /Grill-Me my\nplan ", "request-1", [], "enqueue")).toMatchObject({
    ok: true,
  });
  expect(invoke).toHaveBeenCalledWith({ name: "grill-me", input: "my\nplan" });
  expect(send).toHaveBeenCalledWith({
    prompt: "Run grill-me with my\nplan",
    displayPrompt: "/grill-me my\nplan",
    mode: "enqueue",
  });
  bridge.dispose();
});

it("sends anything that isn't a listed skill as typed", async () => {
  const { session, send, invoke } = skillSession(async () => ({
    kind: "agent-prompt",
    prompt: "x",
  }));
  const bridge = createSessionBridge(session);
  const typed = [
    "/compact now",
    "/usr/bin/env is odd",
    "/",
    "hi /Grill-Me",
    "see a/grill-me",
    "open ~/grill-me or ./grill-me",
    "http://x/grill-me",
    "/grill-me/notes.md",
    "hi /grill-me/x",
  ];
  for (const [at, text] of typed.entries()) {
    await bridge.send(text, `request-${at}`);
    expect(send).toHaveBeenLastCalledWith({ prompt: text, mode: "immediate" });
  }
  expect(invoke).not.toHaveBeenCalled();
  bridge.dispose();
});

it("rejects a skill the session won't expand without sending anything", async () => {
  const refused = skillSession(async () => {
    throw new Error("Unknown slash command: /grill-me");
  });
  let bridge = createSessionBridge(refused.session);
  expect(await bridge.send("/grill-me", "request-1")).toMatchObject({
    ok: false,
    status: "rejected",
    code: ERROR_CODES.sendFailed,
    message: "Unknown slash command: /grill-me",
  });
  bridge.dispose();
  const odd = skillSession(async () => ({ kind: "text", text: "Hello" }));
  bridge = createSessionBridge(odd.session);
  expect(await bridge.send("/grill-me", "request-1")).toMatchObject({
    status: "rejected",
    message: expect.stringContaining("/grill-me didn't start"),
  });
  expect([...refused.send.mock.calls, ...odd.send.mock.calls]).toEqual([]);
  bridge.dispose();
});

it("finds slash words anywhere, skipping paths and repeats", () => {
  expect(slashWords("/tdd fix /grill-me, then /tdd.\n/plugin:pdf a/b /x/y ~/z (/w")).toEqual([
    "tdd",
    "grill-me",
    "plugin:pdf",
  ]);
  expect(slashWords("http://x/y and 1/2 and/or")).toEqual([]);
});

it("runs skills named mid-text before the whole message, like the Copilot CLI", async () => {
  const { session, send, invoke } = skillSession(
    async (params) => ({ kind: "agent-prompt", prompt: `Skill ${params.name}` }),
    ["grill-me", "tdd"],
  );
  const bridge = createSessionBridge(session);
  await bridge.send("  please /grill-me my plan ", "request-1");
  expect(invoke).toHaveBeenLastCalledWith({ name: "grill-me" });
  expect(send).toHaveBeenLastCalledWith({
    prompt: "Skill grill-me\n\nplease /grill-me my plan",
    displayPrompt: "please /grill-me my plan",
    mode: "immediate",
  });
  invoke.mockClear();
  await bridge.send(
    "/Grill-Me fix it\nwith /tdd, then /grill-me and /tdd",
    "request-2",
    [],
    "enqueue",
  );
  expect(invoke.mock.calls).toEqual([[{ name: "grill-me" }], [{ name: "tdd" }]]);
  expect(send).toHaveBeenLastCalledWith({
    prompt: "Skill grill-me\n\nSkill tdd\n\n/Grill-Me fix it\nwith /tdd, then /grill-me and /tdd",
    displayPrompt: "/Grill-Me fix it\nwith /tdd, then /grill-me and /tdd",
    mode: "enqueue",
  });
  bridge.dispose();
});

it("sends nothing when a mid-text skill won't expand", async () => {
  const { session, send } = skillSession(
    async (params) => {
      if (params.name === "tdd") throw new Error("Unknown slash command: /tdd");
      return { kind: "agent-prompt", prompt: "x" };
    },
    ["grill-me", "tdd"],
  );
  const bridge = createSessionBridge(session);
  expect(await bridge.send("use /grill-me and /tdd", "request-1")).toMatchObject({
    ok: false,
    message: "Unknown slash command: /tdd",
  });
  expect(send).not.toHaveBeenCalled();
  bridge.dispose();
});
