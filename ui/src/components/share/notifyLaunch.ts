// Pure logic for the automatic notification prompt on a device's first visit and for the bell's look.

const OUTCOME_KEY = "copilot-canvas:notify-launch";

/** A request that returns "default" faster than a person could answer was never shown a prompt. */
export const QUICK_DECLINE_MS = 500;

/** Events that count as a user gesture; browsers and iOS only show the prompt from one. */
export const GESTURE_EVENTS = ["click", "keydown"] as const;

export type Permission = "default" | "granted" | "denied";
export type Outcome = "granted" | "denied" | "dismissed";

export interface OutcomeStore {
  get(): string | null;
  set(outcome: Outcome): void;
}

/** The answer is remembered per origin, so each device and browser asks once. */
export function localOutcomeStore(): OutcomeStore {
  let memory: string | null = null;
  return {
    get() {
      try {
        return window.localStorage.getItem(OUTCOME_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    set(outcome) {
      memory = outcome;
      try {
        window.localStorage.setItem(OUTCOME_KEY, outcome);
      } catch {
        // Private mode: ask again next visit rather than fail.
      }
    },
  };
}

export const toOutcome = (permission: Permission): Outcome =>
  permission === "default" ? "dismissed" : permission;

export interface LaunchEnv {
  /** Notification, PushManager and service workers all exist here. */
  supported: boolean;
  /** iOS only shows the prompt from a tap, so there is no point trying at launch. */
  needsGesture: boolean;
  permission(): Permission;
  /** Requests permission as its first await and subscribes when it is granted. */
  enable(): Promise<Permission>;
  store: OutcomeStore;
  gestureTarget: EventTarget;
  now(): number;
}

const noop = () => {};
const CAPTURE = { capture: true };

/**
 * Asks for notification permission once per device, on the first visit, in a tab or the installed
 * app. Tries straight away; where the browser shows nothing without a gesture, waits for the first
 * tap or key press instead. Any answer is stored and ends the automatic prompting. Returns a
 * function that removes a pending gesture listener.
 */
export function startFirstLaunch(env: LaunchEnv): () => void {
  if (!env.supported || env.store.get() !== null) return noop;
  const current = env.permission();
  if (current === "denied") {
    env.store.set("denied");
    return noop;
  }
  const settle = (permission: Permission) => env.store.set(toOutcome(permission));
  if (current === "granted") {
    // Granted earlier (for example in a tab): no prompt, just finish subscribing.
    env.store.set("granted");
    void env.enable();
    return noop;
  }

  let cancelled = false;
  let armed = false;
  const onGesture = () => {
    disarm();
    void env.enable().then(settle);
  };
  const arm = () => {
    if (cancelled || armed) return;
    armed = true;
    for (const name of GESTURE_EVENTS) env.gestureTarget.addEventListener(name, onGesture, CAPTURE);
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const name of GESTURE_EVENTS)
      env.gestureTarget.removeEventListener(name, onGesture, CAPTURE);
  };

  if (env.needsGesture) {
    arm();
  } else {
    const startedAt = env.now();
    void env
      .enable()
      .then((permission) => {
        if (permission === "default" && env.now() - startedAt < QUICK_DECLINE_MS) arm();
        else settle(permission);
      })
      .catch(arm);
  }
  return () => {
    cancelled = true;
    disarm();
  };
}

export interface BellInput {
  supported: boolean;
  standalone: boolean;
  permission: Permission;
  subscribed: boolean;
  /** Still reading the current subscription. */
  checking: boolean;
  /** The user pressed Turn off. */
  deliberatelyOff: boolean;
}

export interface BellView {
  /** Bell with a slash: notifications aren't active and the user hasn't turned them off. */
  slashed: boolean;
  label: string;
}

/**
 * Slashed until the user approves notifications or turns them off on purpose. A deliberate off
 * (the Turn off button or a blocked permission) keeps the plain bell, as before, so it never nags.
 */
export function bellView(input: BellInput): BellView {
  if (!input.supported) {
    return {
      slashed: true,
      label: input.standalone
        ? "Notifications unavailable"
        : "Notifications unavailable. Add to Home Screen",
    };
  }
  if (input.checking) return { slashed: false, label: "Notifications" };
  if (input.permission === "denied" || input.deliberatelyOff) {
    return { slashed: false, label: "Notifications" };
  }
  if (input.subscribed && input.permission === "granted") {
    return { slashed: false, label: "Notifications on" };
  }
  return { slashed: true, label: "Notifications off. Turn on" };
}
