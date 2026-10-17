// Serialized native setting changes, derived availability, and authoritative read-back.
import { ERROR_CODES, isPlainObject } from "../../shared/contract.mts";
import type {
  ControlChange,
  ModelOption,
  SessionControls,
  SessionMode,
} from "../../shared/contract.mts";
import type { SessionEventLike } from "../../shared/transcript.mts";
import type { Logger } from "../logging.mts";
import { EFFORT_PATTERN, isMode, isTier } from "./model-options.mts";
import type { CurrentModel } from "./model-options.mts";
import { ControlError, createControlsRpcAdapter, describe, unavailable } from "./rpc-adapter.mts";
import type { ControlsRpcLike } from "./rpc-adapter.mts";

const EVENT_REFRESH_DELAY_MS = 150;

export interface ControlsSessionLike {
  on(handler: (event: SessionEventLike) => void): () => void;
  readonly rpc?: ControlsRpcLike;
}
export interface ControlsService {
  /** Resolves once each control initially loaded or was marked unavailable. */
  ready: Promise<void>;
  get(): SessionControls;
  refresh(): Promise<SessionControls>;
  /** Rejects with a `ControlError` (code from ERROR_CODES). */
  apply(change: ControlChange): Promise<SessionControls>;
  subscribe(listener: (controls: SessionControls) => void): () => void;
  dispose(): void;
}

export function createControlsService(
  session: ControlsSessionLike,
  { log = () => {} }: { log?: Logger } = {},
): ControlsService {
  const rpc = createControlsRpcAdapter(session, log);
  const listeners = new Set<(controls: SessionControls) => void>();
  let mode: SessionMode | undefined;
  let modeReadable = false;
  let current: CurrentModel = {};
  let currentReadable = false;
  let models: ModelOption[] = [];
  let state: SessionControls = compute();
  let queue: Promise<unknown> = Promise.resolve();
  let eventTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function compute(): SessionControls {
    const { ok: modeOk } = rpc.modeApi();
    const { switchable, effortSettable } = rpc.modelApi();
    const active = current.modelId
      ? models.find((model) => model.id === current.modelId)
      : undefined;
    // Routed models may be absent from the catalog; only listed metadata supplies their options.
    const listed = currentReadable && models.length > 0 && active !== undefined;
    const next: SessionControls = {
      available: {
        mode: modeOk && modeReadable && mode !== undefined,
        model: switchable && currentReadable && models.length > 0,
        reasoningEffort: effortSettable && listed && (active?.reasoningEfforts?.length ?? 0) > 0,
        contextTier:
          switchable && listed && (active?.contextTiers?.includes("long_context") ?? false),
      },
      models: models.map((model) => ({ ...model })),
    };
    if (mode !== undefined) next.mode = mode;
    if (current.modelId !== undefined) next.modelId = current.modelId;
    if (current.reasoningEffort !== undefined) next.reasoningEffort = current.reasoningEffort;
    if (current.contextTier !== undefined) next.contextTier = current.contextTier;
    return next;
  }
  function publish(): void {
    if (disposed) return;
    const next = compute();
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch (error) {
        log(`Controls listener failed: ${describe(error)}`, "warning");
      }
    }
  }
  async function readMode(): Promise<void> {
    const value = await rpc.readMode();
    if (isMode(value)) {
      mode = value;
      modeReadable = true;
    }
  }
  async function readCurrent(): Promise<void> {
    const value = await rpc.readCurrent();
    if (value !== undefined) {
      current = value;
      currentReadable = true;
    }
  }
  async function readModels(): Promise<void> {
    const value = await rpc.readModels();
    if (value !== undefined) models = value;
  }
  async function refresh(): Promise<SessionControls> {
    await Promise.all([readMode(), readCurrent(), readModels()]);
    publish();
    return state;
  }
  function scheduleCurrentRead(): void {
    if (disposed || eventTimer !== null) return;
    eventTimer = setTimeout(() => {
      eventTimer = null;
      void readCurrent().then(publish);
    }, EVENT_REFRESH_DELAY_MS);
    eventTimer.unref?.();
  }
  // Events carry new values; follow-up reads keep omitted fields authoritative.
  function onEvent(event: SessionEventLike): void {
    if (disposed || !event || event.agentId) return;
    const data = isPlainObject(event.data) ? event.data : {};
    if (event.type === "session.mode_changed") {
      if (isMode(data.newMode)) {
        mode = data.newMode;
        modeReadable = true;
        publish();
      }
      scheduleCurrentRead();
      return;
    }
    if (event.type === "session.model_change") {
      if (typeof data.newModel === "string" && data.newModel) {
        const next: CurrentModel = { ...current, modelId: data.newModel };
        if ("reasoningEffort" in data) {
          if (
            typeof data.reasoningEffort === "string" &&
            EFFORT_PATTERN.test(data.reasoningEffort)
          ) {
            next.reasoningEffort = data.reasoningEffort;
          } else {
            delete next.reasoningEffort;
          }
        }
        if ("contextTier" in data) {
          if (isTier(data.contextTier)) next.contextTier = data.contextTier;
          else delete next.contextTier;
        }
        current = next;
        publish();
      }
      scheduleCurrentRead();
    }
  }
  let unsubscribe: () => void = () => {};
  try {
    unsubscribe = session.on(onEvent);
  } catch (error) {
    log(`Could not watch session settings: ${describe(error)}`, "warning");
  }
  const ready = refresh().then(
    () => undefined,
    () => undefined,
  );

  async function run(change: ControlChange): Promise<SessionControls> {
    await ready;
    if (disposed) throw unavailable("The session is no longer connected.");
    // Keep synchronous validation/native throws distinct from a rejected RPC promise.
    const call = rpc.apply(change, compute(), current, mode, models);
    let result: unknown;
    try {
      result = await call;
    } catch (error) {
      log(`Session setting change failed: ${describe(error)}`, "warning");
      void refresh();
      throw new ControlError(ERROR_CODES.controlFailed, "The session did not apply the change.");
    }
    if ("mode" in change && isPlainObject(result) && result.modeApplied === false) {
      await refresh();
      throw new ControlError(ERROR_CODES.controlFailed, "The session kept its current mode.");
    }
    // A mode change can switch models (plan mode), so re-read both.
    await Promise.all(["mode" in change ? readMode() : Promise.resolve(), readCurrent()]);
    publish();
    return state;
  }
  function apply(change: ControlChange): Promise<SessionControls> {
    const next = queue.then(
      () => run(change),
      () => run(change),
    );
    queue = next.catch(() => undefined);
    return next;
  }
  return {
    ready,
    get: () => state,
    refresh,
    apply,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (eventTimer !== null) clearTimeout(eventTimer);
      eventTimer = null;
      listeners.clear();
      try {
        unsubscribe();
      } catch {
        // Session may already be disconnected.
      }
    },
  };
}
