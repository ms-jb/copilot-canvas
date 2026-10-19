import { describe, expect, it } from "vite-plus/test";
import {
  bellView,
  GESTURE_EVENTS,
  QUICK_DECLINE_MS,
  startFirstLaunch,
  type BellInput,
  type LaunchEnv,
  type Outcome,
  type Permission,
} from "../../ui/src/components/share/notifyLaunch";

function setup(
  options: {
    permission?: Permission;
    supported?: boolean;
    needsGesture?: boolean;
    stored?: Outcome | null;
    // What the browser answers, and how long the answer takes in ms.
    answer?: Permission;
    delay?: number;
  } = {},
) {
  let permission = options.permission ?? "default";
  let stored: string | null = options.stored ?? null;
  let clock = 0;
  const calls = { enable: 0 };
  const target = new EventTarget();
  const env: LaunchEnv = {
    supported: options.supported ?? true,
    needsGesture: options.needsGesture ?? false,
    permission: () => permission,
    enable: async () => {
      calls.enable++;
      clock += options.delay ?? 3000;
      permission = options.answer ?? "granted";
      return permission;
    },
    store: {
      get: () => stored,
      set: (outcome) => {
        stored = outcome;
      },
    },
    gestureTarget: target,
    now: () => clock,
  };
  return { env, calls, target, stored: () => stored };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startFirstLaunch", () => {
  it("prompts once at launch in a tab or the installed app, then remembers the answer", async () => {
    const run = setup();
    startFirstLaunch(run.env);
    await flush();
    expect(run.calls.enable).toBe(1);
    expect(run.stored()).toBe("granted");
    startFirstLaunch(run.env);
    await flush();
    expect(run.calls.enable).toBe(1);
  });

  it.each([
    ["denied", "denied"],
    ["default", "dismissed"],
  ] as const)("a %s answer is stored as %s and never asked again", async (answer, outcome) => {
    const run = setup({ answer });
    startFirstLaunch(run.env);
    await flush();
    expect(run.stored()).toBe(outcome);
    run.target.dispatchEvent(new Event("click"));
    startFirstLaunch(run.env);
    await flush();
    expect(run.calls.enable).toBe(1);
  });

  it("does not prompt where push is unsupported", async () => {
    const run = setup({ supported: false });
    startFirstLaunch(run.env);
    run.target.dispatchEvent(new Event("click"));
    await flush();
    expect(run.calls.enable).toBe(0);
    expect(run.stored()).toBeNull();
  });

  it("does not prompt after an earlier answer, and records a permission set elsewhere", async () => {
    const answered = setup({ stored: "dismissed" });
    startFirstLaunch(answered.env);
    expect(answered.calls.enable).toBe(0);

    const blocked = setup({ permission: "denied" });
    startFirstLaunch(blocked.env);
    expect(blocked.calls.enable).toBe(0);
    expect(blocked.stored()).toBe("denied");
  });

  it("finishes subscribing without a prompt when permission was already granted", async () => {
    const run = setup({ permission: "granted" });
    startFirstLaunch(run.env);
    await flush();
    expect(run.calls.enable).toBe(1);
    expect(run.stored()).toBe("granted");
  });

  it("waits for the first tap when the platform needs a gesture, then asks once", async () => {
    const run = setup({ needsGesture: true });
    startFirstLaunch(run.env);
    await flush();
    expect(run.calls.enable).toBe(0);
    run.target.dispatchEvent(new Event("click"));
    run.target.dispatchEvent(new Event("keydown"));
    await flush();
    expect(run.calls.enable).toBe(1);
    expect(run.stored()).toBe("granted");
  });

  it("falls back to the first key press when an immediate request shows nothing", async () => {
    const run = setup({ answer: "default", delay: QUICK_DECLINE_MS - 1 });
    startFirstLaunch(run.env);
    await flush();
    expect(run.stored()).toBeNull();
    expect(run.calls.enable).toBe(1);
    run.target.dispatchEvent(new Event("keydown"));
    await flush();
    expect(run.calls.enable).toBe(2);
    expect(run.stored()).toBe("dismissed");
    run.target.dispatchEvent(new Event("keydown"));
    await flush();
    expect(run.calls.enable).toBe(2);
  });

  it("removes the pending listeners when cancelled", async () => {
    const run = setup({ needsGesture: true });
    startFirstLaunch(run.env)();
    for (const name of GESTURE_EVENTS) run.target.dispatchEvent(new Event(name));
    await flush();
    expect(run.calls.enable).toBe(0);
  });
});

describe("bellView", () => {
  const base: BellInput = {
    supported: true,
    standalone: false,
    permission: "default",
    subscribed: false,
    checking: false,
    deliberatelyOff: false,
  };

  it("is slashed in a tab and in the installed app until notifications are active", () => {
    for (const standalone of [false, true]) {
      expect(bellView({ ...base, standalone })).toEqual({
        slashed: true,
        label: "Notifications off. Turn on",
      });
      // Allowed in the browser but the subscription is missing.
      expect(bellView({ ...base, standalone, permission: "granted" }).slashed).toBe(true);
    }
  });

  it("is a plain bell once approved and subscribed", () => {
    expect(bellView({ ...base, permission: "granted", subscribed: true })).toEqual({
      slashed: false,
      label: "Notifications on",
    });
  });

  it("stays plain, quietly, when notifications are off on purpose, blocked or still loading", () => {
    expect(bellView({ ...base, deliberatelyOff: true }).slashed).toBe(false);
    expect(bellView({ ...base, permission: "denied" }).slashed).toBe(false);
    expect(bellView({ ...base, checking: true }).slashed).toBe(false);
  });

  it("is slashed with an Add to Home Screen hint where push is unsupported", () => {
    expect(bellView({ ...base, supported: false })).toEqual({
      slashed: true,
      label: "Notifications unavailable. Add to Home Screen",
    });
    expect(bellView({ ...base, supported: false, standalone: true }).label).toBe(
      "Notifications unavailable",
    );
  });
});
