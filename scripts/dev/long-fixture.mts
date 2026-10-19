// A long conversation for performance checks: `?state=long` in `npx vp dev` and the
// `scripts/dev/perf-stack.mts` provider both use it, so their numbers are comparable.
import type { TranscriptEntry } from "../../src/shared/contract.mts";
import type { SessionEventLike } from "../../src/shared/transcript.mts";
import { SCRIPT } from "./fixtures.mts";

const CODE_REPLY = `Here is the helper, with tests and shell output:

\`\`\`ts
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("size must be at least 1");
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
\`\`\`

\`\`\`ts
it("splits evenly and keeps the remainder", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
\`\`\`

\`\`\`bash
pnpm test --filter markdown
\`\`\`

\`\`\`json
{"feature":"markdown-code-blocks","status":"ready","checks":["check","test","build"]}
\`\`\`

\`\`\`python
def greet(name: str) -> str:
    return f"hello {name}"
\`\`\`

\`\`\`unknown
https://example.test/${"very-long-line-".repeat(12)}end
\`\`\`

It copies nothing but the slices, so it stays **O(n)**.`;

const TABLE_REPLY = `Status of the tasks:

| Task | Branch | Doing | Status |
| --- | --- | --- | :-: |
| perf | feat/perf | Caching and code splitting | Running |
| docs | feat/docs | Keyboard shortcuts | Running |
| tests | feat/tests | Gateway routes | Queued |

- [x] Baseline measured
- [ ] After numbers
- [ ] Merge`;

const REPLIES = [...SCRIPT.map((turn) => turn.reply), CODE_REPLY, TABLE_REPLY];
const PROMPTS = [...SCRIPT.map((turn) => turn.prompt), "Write the chunk helper.", "Status?"];

/** A long Markdown reply streamed in the performance checks (about 6 KB). */
export const LONG_REPLY = [
  "Here is the full write-up, section by section.",
  ...REPLIES,
  ...REPLIES.map((reply) => reply.replace(/\*\*/g, "_")),
].join("\n\n");

const START = Date.UTC(2026, 9, 12, 15, 0, 0);
const at = (index: number) => new Date(START + index * 7 * 60_000).toISOString();

/** `count` entries alternating user and assistant, a few minutes apart over several days. */
export function longTranscript(count = 500): TranscriptEntry[] {
  return Array.from({ length: count }, (_, index): TranscriptEntry => {
    const turn = Math.floor(index / 2);
    return index % 2 === 0
      ? {
          id: `user:long-${turn}`,
          kind: "user",
          text: PROMPTS[turn % PROMPTS.length]!,
          timestamp: at(index),
        }
      : {
          id: `assistant:long-${turn}`,
          kind: "assistant",
          text: REPLIES[turn % REPLIES.length]!,
          timestamp: at(index),
        };
  });
}

/** The same conversation as session history events, for a real provider. */
export function longHistory(count = 500): SessionEventLike[] {
  return longTranscript(count).map((entry) => {
    const messageId = entry.id.replace(/^\w+:/, "");
    return {
      id: `event-${entry.id}`,
      type: entry.kind === "user" ? "user.message" : "assistant.message",
      timestamp: entry.timestamp,
      data: { messageId, content: entry.text },
    };
  });
}
