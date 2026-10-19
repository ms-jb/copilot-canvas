import type { Phase, SessionsInfo } from "../../src/shared/contract.mts";
import { SESSION_ID, type Scenario } from "./fixtures.mts";

export function mockSessionList(scenario: Scenario, phase: Phase): SessionsInfo {
  const now = Date.now();
  return {
    sessionId: SESSION_ID,
    source: scenario === "offline" ? "unavailable" : "app",
    checkedAt: new Date(now).toISOString(),
    sessions:
      scenario === "empty" || scenario === "offline"
        ? []
        : [
            {
              id: SESSION_ID,
              title: "Canvas preview",
              project: "demo/canvas",
              state: phase === "working" ? "busy" : phase,
              updatedAt: new Date(now - 30_000).toISOString(),
              current: true,
              canOpen: false,
            },
            {
              id: "11111111-1111-4111-8111-111111111111",
              title: "Refresh the welcome page",
              project: "demo/website",
              state: "busy",
              updatedAt: new Date(now - 120_000).toISOString(),
              current: false,
              canOpen: true,
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              title: "Review the release checklist",
              project: "demo/docs",
              state: "waiting",
              updatedAt: new Date(now - 900_000).toISOString(),
              current: false,
              canOpen: true,
            },
          ],
  };
}
