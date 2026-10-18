import { expect, it } from "vite-plus/test";
import { SCENARIOS, SAMPLE_CONTEXT, SAMPLE_SKILLS } from "../../scripts/dev/fixtures.mts";
import { createSessions, queueState } from "../../scripts/dev/session.mts";
import {
  validateContextState,
  validateQueueState,
  validateSkills,
  validateSnapshot,
} from "../../src/shared/contract.mts";

it.each(SCENARIOS)("keeps %s preview fixtures compatible with chat resources", (scenario) => {
  const session = createSessions().get(scenario);
  expect(
    validateSnapshot({
      entries: session.entries,
      status: session.status,
      activity: session.activity,
      context: session.context,
    }),
  ).toBe(true);
  expect(validateQueueState(queueState(session))).toBe(true);
  expect(validateContextState(SAMPLE_CONTEXT)).toBe(true);
  expect(validateSkills(SAMPLE_SKILLS)).toBe(true);
  if (scenario !== "empty")
    expect(session.entries.some((entry) => entry.text.includes("```ts"))).toBe(true);
  if (scenario === "busy") expect(session.activity.some((item) => item.kind === "tool")).toBe(true);
});
