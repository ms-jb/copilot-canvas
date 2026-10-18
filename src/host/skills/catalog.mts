// The session's user-invocable skills for the composer's slash picker, and the expansion that runs them.
// The list and the invocation both come from the session's own slash-command RPC, so the canvas runs a
// skill as the Copilot CLI does: commands.invoke turns `/name input` into the agent prompt, and the
// caller sends that prompt with the typed text as its display text. Like the CLI (1.0.98+), skills
// named mid-text (`please /tdd this`) run too: each is invoked without input and its prompt goes
// before the message, which is sent whole.
import {
  SKILL_LIMITS,
  isSkillName,
  parseSlashCommand,
  type SkillSummary,
  type SkillsInfo,
} from "../../shared/contract.mts";
import { describeSessionError, type Logger } from "../logging.mts";
import { readWithTimeout } from "../read-timeout.mts";

/** The slice of `session.rpc` the catalog uses (experimental SDK APIs, so all optional). */
export interface SkillsRpcLike {
  commands?: {
    list?: (params?: {
      includeBuiltins?: boolean;
      includeSkills?: boolean;
      includeClientCommands?: boolean;
    }) => Promise<unknown>;
    invoke?: (params: { name: string; input?: string }) => Promise<unknown>;
  };
  skills?: { list?: () => Promise<unknown> };
}

export interface SkillPrompt {
  prompt: string;
  displayPrompt?: string;
}

export interface SkillCatalog {
  /** Cached briefly; never rejects. */
  list(): Promise<SkillsInfo>;
  /**
   * What to send for `text`: a lone leading `/name input` becomes that skill's agent prompt; with
   * listed skills named elsewhere in the text, their prompts go first and the whole text follows.
   * Anything else goes as typed. Rejects when the session refuses to expand a listed skill.
   */
  expand(text: string): Promise<SkillPrompt>;
}

const UNAVAILABLE: SkillsInfo = Object.freeze({ available: false, skills: [] });

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * commands.list gives every skill without an argument hint this same placeholder, so it says nothing
 * about the skill. Matched exactly (case aside) so a real, skill-specific hint still shows.
 */
const GENERIC_SKILL_HINT = "instructions for the skill";

/** One line, control characters removed, cut to `max` with an ellipsis. */
function clip(value: unknown, max: number): string {
  const text =
    typeof value === "string"
      ? value
          .slice(0, max * 4)
          .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
          .trim()
      : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Maps a commands.list or skills.list result to the picker's list. Keeps the session's order (its
 * precedence), the first of any names that differ only in case, and only user-invocable skills.
 */
export function toSkillList(value: unknown, from: "commands" | "skills"): SkillSummary[] {
  const rows = record(value)[from];
  const seen = new Set<string>();
  const skills: SkillSummary[] = [];
  for (const raw of Array.isArray(rows) ? rows.slice(0, SKILL_LIMITS.maxSkills * 10) : []) {
    const row = record(raw);
    const runnable =
      from === "commands"
        ? row.kind === "skill"
        : row.userInvocable === true && row.enabled !== false;
    const name = from === "skills" && row.commandName !== undefined ? row.commandName : row.name;
    if (!runnable || !isSkillName(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const hint = clip(
      from === "commands" ? record(row.input).hint : row.argumentHint,
      SKILL_LIMITS.maxHint,
    );
    skills.push({
      name,
      description: clip(row.description, SKILL_LIMITS.maxDescription),
      hint: hint && hint.toLowerCase() !== GENERIC_SKILL_HINT ? hint : null,
    });
    if (skills.length === SKILL_LIMITS.maxSkills) break;
  }
  return skills;
}

/**
 * Slash words anywhere in `text` that could name skills, in order and without repeats: at the start
 * or after whitespace, and not a path (`/usr/bin`, `a/b`, `http://x/y`). Trailing `.` or `:` is
 * punctuation (`try /tdd.`).
 */
export function slashWords(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?<!\S)\/([\w.:-]+)(?![\w.:/-])/g)) {
    const name = match[1]!.replace(/[.:]+$/, "");
    if (name) names.add(name);
  }
  return [...names];
}

export function createSkillCatalog(
  rpc: SkillsRpcLike | undefined,
  {
    log = () => {},
    ttlMs = 15_000,
    now = Date.now,
    timeoutMs = 5000,
  }: { log?: Logger; ttlMs?: number; now?: () => number; timeoutMs?: number } = {},
): SkillCatalog {
  let cached: { at: number; info: SkillsInfo } | null = null;
  let loading: Promise<SkillsInfo> | null = null;

  async function read(): Promise<SkillsInfo> {
    try {
      // commands.list names skills as the CLI's slash commands do (with plugin prefixes).
      if (rpc?.commands?.list) {
        const listed = await readWithTimeout(
          () =>
            rpc.commands!.list!({
              includeBuiltins: false,
              includeSkills: true,
              includeClientCommands: false,
            }),
          timeoutMs,
        );
        if (!Array.isArray(record(listed).commands)) return UNAVAILABLE;
        return { available: true, skills: toSkillList(listed, "commands") };
      }
      if (rpc?.skills?.list) {
        const listed = await readWithTimeout(() => rpc.skills!.list!(), timeoutMs);
        if (!Array.isArray(record(listed).skills)) return UNAVAILABLE;
        return { available: true, skills: toSkillList(listed, "skills") };
      }
    } catch (error) {
      log(`Could not list skills: ${describeSessionError(error)}`, "warning");
    }
    return UNAVAILABLE;
  }

  function list(): Promise<SkillsInfo> {
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.info);
    loading ??= read().then((info) => {
      loading = null;
      // A failed read is retried on the next request instead of being cached.
      if (info.available) cached = { at: now(), info };
      return info;
    });
    return loading;
  }

  async function invokeSkill(
    invoke: NonNullable<NonNullable<SkillsRpcLike["commands"]>["invoke"]>,
    name: string,
    input?: string,
  ) {
    const result = record(
      await readWithTimeout(() => invoke({ name, ...(input ? { input } : {}) }), timeoutMs),
    );
    if (result.kind !== "agent-prompt" || typeof result.prompt !== "string" || !result.prompt) {
      throw new Error(`/${name} didn't start: the session returned no prompt for it.`);
    }
    return {
      prompt: result.prompt,
      displayPrompt: typeof result.displayPrompt === "string" ? result.displayPrompt : undefined,
    };
  }

  async function expand(text: string): Promise<SkillPrompt> {
    const invoke = rpc?.commands?.invoke;
    if (!invoke || !text.includes("/")) return { prompt: text };
    const skills = (await list()).skills;
    const typed = text.trim();
    const command = parseSlashCommand(typed);
    const wanted = command?.name.toLowerCase();
    const lead = skills.find((entry) => entry.name.toLowerCase() === wanted);
    // Named mid-text, a skill must match exactly, as the CLI requires.
    const listed = new Set(skills.map((entry) => entry.name));
    const embedded = slashWords(typed).filter((name) => listed.has(name) && name !== lead?.name);
    if (!embedded.length) {
      if (!lead) return { prompt: text };
      const result = await invokeSkill(invoke, lead.name, command?.input);
      return { prompt: result.prompt, displayPrompt: result.displayPrompt ?? typed };
    }
    const prompts: string[] = [];
    for (const name of lead ? [lead.name, ...embedded] : embedded) {
      prompts.push((await invokeSkill(invoke, name)).prompt);
    }
    return { prompt: [...prompts, typed].join("\n\n"), displayPrompt: typed };
  }

  return { list, expand };
}
