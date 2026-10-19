import { expect, it } from "vite-plus/test";
import { planResume, RESUME_REOPEN_AFTER_MS, watchResume } from "../../ui/src/connection/resume";

function fakePage() {
  const listeners = new Map<string, Set<EventListener>>();
  const target = {
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    },
  };
  const doc = { ...target, visibilityState: "visible" };
  let now = 1_000;
  const resumes: { hiddenMs: number; restored: boolean }[] = [];
  const stop = watchResume({
    doc,
    win: target,
    now: () => now,
    onResume: (resume) => resumes.push(resume),
  });
  const fire = (type: string, event: object = {}) =>
    listeners.get(type)?.forEach((fn) => fn(event as Event));
  return {
    resumes,
    stop,
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    advance: (ms: number) => (now += ms),
    setVisibility(state: "visible" | "hidden") {
      doc.visibilityState = state;
      fire("visibilitychange");
    },
    fire,
  };
}

it("reports one resume with the hidden time when a wake fires several events", () => {
  const page = fakePage();
  page.setVisibility("hidden");
  page.advance(60_000);
  page.setVisibility("visible");
  page.fire("pageshow", { persisted: false });
  page.fire("focus");
  expect(page.resumes).toEqual([{ hiddenMs: 60_000, restored: false }]);
});

it("reports a page restored from the back/forward cache and a returning network", () => {
  const page = fakePage();
  page.fire("pagehide");
  page.advance(30_000);
  page.fire("pageshow", { persisted: true });
  page.advance(5_000);
  page.fire("online");
  expect(page.resumes).toEqual([
    { hiddenMs: 30_000, restored: true },
    { hiddenMs: 0, restored: false },
  ]);
});

it("ignores events while hidden and stops listening when disposed", () => {
  const page = fakePage();
  page.setVisibility("hidden");
  page.fire("focus");
  page.fire("online");
  expect(page.resumes).toEqual([]);
  page.stop();
  expect(page.count()).toBe(0);
});

it("plans a fresh stream after a real absence or a dead stream, nothing for a focus blip", () => {
  const open = { stale: false, hasGeneration: true, streamOpen: true };
  const blip = { hiddenMs: 0, restored: false };
  expect(planResume(blip, open)).toBe("none");
  expect(planResume({ hiddenMs: RESUME_REOPEN_AFTER_MS - 1, restored: false }, open)).toBe("none");
  expect(planResume({ hiddenMs: RESUME_REOPEN_AFTER_MS, restored: false }, open)).toBe("reopen");
  expect(planResume({ hiddenMs: 0, restored: true }, open)).toBe("reopen");
  expect(planResume(blip, { ...open, streamOpen: false })).toBe("reopen");
  const away = { hiddenMs: 60_000, restored: false };
  // A restarted provider asks for a reload; a resume never clears that on its own.
  expect(planResume(away, { ...open, stale: true })).toBe("none");
  expect(planResume(blip, { ...open, stale: true })).toBe("none");
  // Before the first bootstrap succeeded, any resume tries again at once.
  expect(planResume(blip, { ...open, hasGeneration: false })).toBe("bootstrap");
  expect(planResume(away, { ...open, hasGeneration: false })).toBe("bootstrap");
});
