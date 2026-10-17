// Native session controls: mode, model, reasoning effort and context tier.
//
// The SDK marks these RPCs experimental, so every function is feature-detected at runtime. A
// control is reported as available only when its API exists and its current value could be read;
// options come only from what the session reports (nothing is invented). Changes are serialized
// and confirmed by re-reading the session afterwards; live updates come from session events.

import { CONTEXT_TIERS, ERROR_CODES, SESSION_MODES, isPlainObject } from "../shared/contract.mts";
import type {
  ContextTier,
  ControlChange,
  ModelOption,
  SessionControls,
  SessionMode,
} from "../shared/contract.mts";
import type { SessionEventLike } from "../shared/transcript.mts";
import type { Logger } from "./bridge.mts";

const LOAD_TIMEOUT_MS = 10000;
const APPLY_TIMEOUT_MS = 20000;
const EVENT_REFRESH_DELAY_MS = 150;
const MAX_MODELS = 200;
const MAX_NAME_LENGTH = 120;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;

interface CurrentModelLike {
  modelId?: unknown;
  reasoningEffort?: unknown;
  contextTier?: unknown;
}

/** Structural slice of `session.rpc` this service uses. Every member is optional on purpose. */
export interface ControlsRpcLike {
  mode?: {
    get?: () => Promise<unknown>;
    set?: (params: { mode: SessionMode; expectedMode?: SessionMode }) => Promise<unknown>;
  };
  model?: {
    getCurrent?: () => Promise<unknown>;
    switchTo?: (params: {
      modelId: string;
      reasoningEffort?: string | null;
      contextTier?: ContextTier;
      source?: "model_picker";
    }) => Promise<unknown>;
    setReasoningEffort?: (params: { reasoningEffort: string }) => Promise<unknown>;
    list?: (params?: { skipCache?: boolean }) => Promise<unknown>;
  };
}

export interface ControlsSessionLike {
  on(handler: (event: SessionEventLike) => void): () => void;
  readonly rpc?: ControlsRpcLike;
}

export interface ControlsService {
  /** Resolves once the initial load finished (each control either loaded or marked unavailable). */
  ready: Promise<void>;
  get(): SessionControls;
  refresh(): Promise<SessionControls>;
  /** Applies one change. Rejects with a `ControlError` (code from ERROR_CODES). */
  apply(change: ControlChange): Promise<SessionControls>;
  subscribe(listener: (controls: SessionControls) => void): () => void;
  dispose(): void;
}

export class ControlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ControlError";
    this.code = code;
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  return message.replace(/\s+/g, " ").trim().slice(0, 200) || "error";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isMode(value: unknown): value is SessionMode {
  return SESSION_MODES.includes(value as SessionMode);
}

function isTier(value: unknown): value is ContextTier {
  return CONTEXT_TIERS.includes(value as ContextTier);
}

function stringList(value: unknown, pattern: RegExp): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && pattern.test(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Context tiers a model offers. Providers either list them (`supportedContextTiers`) or, for
 * Copilot models, publish long-context pricing (`billing.tokenPrices.longContext`). The default
 * tier is the model's standard window, so it is always paired with long_context.
 */
function contextTiersOf(model: Record<string, unknown>): ContextTier[] {
  const declared = stringList(model.supportedContextTiers, /^[a-z_]{1,32}$/).filter(isTier);
  const billing = isPlainObject(model.billing) ? model.billing : null;
  const prices = billing && isPlainObject(billing.tokenPrices) ? billing.tokenPrices : null;
  const priced = prices !== null && isPlainObject(prices.longContext);
  if (!declared.includes("long_context") && !priced) return [];
  return ["default", "long_context"];
}

export function toModelOption(value: unknown): ModelOption | null {
  if (!isPlainObject(value)) return null;
  const { id, name } = value;
  if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id)) return null;
  if (isPlainObject(value.policy) && value.policy.state === "disabled") return null;
  const label = typeof name === "string" && name.trim() ? name.trim() : id;
  const option: ModelOption = { id, name: label.slice(0, MAX_NAME_LENGTH) };
  // Curated lists carry `supportedReasoningEfforts`; raw catalog entries carry the same list at
  // `capabilities.supports.reasoning_effort`.
  const capabilities = isPlainObject(value.capabilities) ? value.capabilities : null;
  const supports =
    capabilities && isPlainObject(capabilities.supports) ? capabilities.supports : null;
  const efforts = stringList(
    Array.isArray(value.supportedReasoningEfforts)
      ? value.supportedReasoningEfforts
      : supports?.reasoning_effort,
    EFFORT_PATTERN,
  );
  if (efforts.length > 0) {
    option.reasoningEfforts = efforts;
    if (
      typeof value.defaultReasoningEffort === "string" &&
      efforts.includes(value.defaultReasoningEffort)
    ) {
      option.defaultReasoningEffort = value.defaultReasoningEffort;
    }
  }
  const tiers = contextTiersOf(value);
  if (tiers.length > 0) option.contextTiers = tiers;
  return option;
}

function parseModelList(value: unknown): ModelOption[] {
  const list = isPlainObject(value) && Array.isArray(value.list) ? value.list : [];
  const models: ModelOption[] = [];
  for (const item of list) {
    const option = toModelOption(item);
    if (option && !models.some((existing) => existing.id === option.id)) models.push(option);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function fn(value: unknown): boolean {
  return typeof value === "function";
}

function sameControls(a: SessionControls, b: SessionControls): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createControlsService(
  session: ControlsSessionLike,
  { log = () => {} }: { log?: Logger } = {},
): ControlsService {
  const listeners = new Set<(controls: SessionControls) => void>();
  let mode: SessionMode | undefined;
  let modeReadable = false;
  let current: { modelId?: string; reasoningEffort?: string; contextTier?: ContextTier } = {};
  let currentReadable = false;
  let models: ModelOption[] = [];
  let state: SessionControls = compute();
  let queue: Promise<unknown> = Promise.resolve();
  let eventTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // `session.rpc` is a getter on the real SDK; read it lazily and tolerate it throwing.
  function rpc(): ControlsRpcLike {
    try {
      const value = session.rpc;
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function modeApi() {
    const api = rpc().mode;
    return { api, ok: !!api && fn(api.get) && fn(api.set) };
  }

  function modelApi() {
    const api = rpc().model;
    return {
      api,
      switchable: !!api && fn(api.getCurrent) && fn(api.switchTo),
      effortSettable:
        !!api && fn(api.getCurrent) && (fn(api.setReasoningEffort) || fn(api.switchTo)),
    };
  }

  function currentModel(): ModelOption | undefined {
    return current.modelId ? models.find((model) => model.id === current.modelId) : undefined;
  }

  function compute(): SessionControls {
    const { ok: modeOk } = modeApi();
    const { switchable, effortSettable } = modelApi();
    const active = currentModel();
    // The current model may be missing from the list (for example a routed model); the picker can
    // still switch to listed models, but per-model options need the current model's metadata.
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
    if (sameControls(next, state)) return;
    state = next;
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch (error) {
        log(`Controls listener failed: ${describe(error)}`, "warning");
      }
    }
  }

  function setCurrent(value: unknown): void {
    if (!isPlainObject(value)) return;
    const model = value as CurrentModelLike;
    const next: typeof current = {};
    if (typeof model.modelId === "string" && model.modelId) next.modelId = model.modelId;
    if (typeof model.reasoningEffort === "string" && EFFORT_PATTERN.test(model.reasoningEffort)) {
      next.reasoningEffort = model.reasoningEffort;
    }
    if (isTier(model.contextTier)) next.contextTier = model.contextTier;
    current = next;
    currentReadable = true;
  }

  async function readMode(): Promise<void> {
    const { api, ok } = modeApi();
    if (!ok || !api?.get) return;
    try {
      const value = await withTimeout(api.get(), LOAD_TIMEOUT_MS, "mode.get");
      if (isMode(value)) {
        mode = value;
        modeReadable = true;
      }
    } catch (error) {
      log(`Session mode unavailable: ${describe(error)}`, "warning");
    }
  }

  async function readCurrent(): Promise<void> {
    const api = rpc().model;
    if (!api || !fn(api.getCurrent)) return;
    try {
      setCurrent(await withTimeout(api.getCurrent!(), LOAD_TIMEOUT_MS, "model.getCurrent"));
    } catch (error) {
      log(`Current model unavailable: ${describe(error)}`, "warning");
    }
  }

  async function readModels(): Promise<void> {
    const api = rpc().model;
    if (!api || !fn(api.list)) return;
    try {
      models = parseModelList(await withTimeout(api.list!(), LOAD_TIMEOUT_MS, "model.list"));
    } catch (error) {
      log(`Model list unavailable: ${describe(error)}`, "warning");
    }
  }

  async function refresh(): Promise<SessionControls> {
    await Promise.all([readMode(), readCurrent(), readModels()]);
    publish();
    return state;
  }

  // Events carry the new values; a follow-up read keeps fields the event omits authoritative.
  function scheduleCurrentRead(): void {
    if (disposed || eventTimer !== null) return;
    eventTimer = setTimeout(() => {
      eventTimer = null;
      void readCurrent().then(publish);
    }, EVENT_REFRESH_DELAY_MS);
    eventTimer.unref?.();
  }

  function onEvent(event: SessionEventLike): void {
    if (disposed || !event || event.agentId) return;
    const data = isPlainObject(event.data) ? event.data : {};
    if (event.type === "session.mode_changed") {
      if (isMode(data.newMode)) {
        mode = data.newMode;
        modeReadable = true;
        publish();
      }
      // Entering or leaving plan mode can switch the model as well.
      scheduleCurrentRead();
      return;
    }
    if (event.type === "session.model_change") {
      if (typeof data.newModel === "string" && data.newModel) {
        const next: typeof current = { ...current, modelId: data.newModel };
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

  function unavailable(message: string): ControlError {
    return new ControlError(ERROR_CODES.controlUnavailable, message);
  }

  function invalid(message: string): ControlError {
    return new ControlError(ERROR_CODES.badRequest, message);
  }

  async function run(change: ControlChange): Promise<SessionControls> {
    await ready;
    if (disposed) throw unavailable("The session is no longer connected.");
    const controls = compute();
    const active = currentModel();
    const { api: model } = modelApi();
    let call: Promise<unknown>;

    if ("mode" in change) {
      const { api } = modeApi();
      if (!controls.available.mode || !api?.set) throw unavailable("Mode can't be changed here.");
      // expectedMode makes the runtime refuse the change if another client changed the mode first.
      call = api.set({ mode: change.mode, ...(mode ? { expectedMode: mode } : {}) });
    } else if ("modelId" in change) {
      if (!controls.available.model || !model?.switchTo) {
        throw unavailable("The model can't be changed here.");
      }
      const target = models.find((option) => option.id === change.modelId);
      if (!target) throw invalid("That model is not available in this session.");
      // Keep the current effort when the target supports it; otherwise fall back to its default
      // (null clears the override) instead of carrying an effort the model does not offer.
      const keepEffort =
        current.reasoningEffort === undefined ||
        (target.reasoningEfforts?.includes(current.reasoningEffort) ?? false);
      call = model.switchTo({
        modelId: target.id,
        ...(keepEffort ? {} : { reasoningEffort: null }),
        source: "model_picker",
      });
    } else if ("reasoningEffort" in change) {
      if (!controls.available.reasoningEffort || !active || !model) {
        throw unavailable("Reasoning effort can't be changed for this model.");
      }
      if (!active.reasoningEfforts?.includes(change.reasoningEffort)) {
        throw invalid("This model does not support that reasoning effort.");
      }
      call = model.setReasoningEffort
        ? model.setReasoningEffort({ reasoningEffort: change.reasoningEffort })
        : model.switchTo!({
            modelId: active.id,
            reasoningEffort: change.reasoningEffort,
            source: "model_picker",
          });
    } else {
      if (!controls.available.contextTier || !active || !model?.switchTo) {
        throw unavailable("Context tier can't be changed for this model.");
      }
      if (!active.contextTiers?.includes(change.contextTier)) {
        throw invalid("This model does not offer that context tier.");
      }
      call = model.switchTo({
        modelId: active.id,
        contextTier: change.contextTier,
        source: "model_picker",
      });
    }

    let result: unknown;
    try {
      result = await withTimeout(Promise.resolve(call), APPLY_TIMEOUT_MS, "change");
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
