import { ERROR_CODES } from "../../shared/contract.mts";
import type {
  ContextTier,
  ControlChange,
  ModelOption,
  SessionControls,
  SessionMode,
} from "../../shared/contract.mts";
import type { Logger } from "../logging.mts";
import { parseCurrentModel, parseModelList } from "./model-options.mts";
import type { CurrentModel } from "./model-options.mts";

const LOAD_TIMEOUT_MS = 10000;
const APPLY_TIMEOUT_MS = 20000;

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

export class ControlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ControlError";
    this.code = code;
  }
}

export function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : "error";
  return message.replace(/\s+/g, " ").trim().slice(0, 200) || "error";
}
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const fn = (value: unknown): boolean => typeof value === "function";
export const unavailable = (message: string) =>
  new ControlError(ERROR_CODES.controlUnavailable, message);
const invalid = (message: string) => new ControlError(ERROR_CODES.badRequest, message);

export function createControlsRpcAdapter(session: { readonly rpc?: ControlsRpcLike }, log: Logger) {
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
  async function readMode(): Promise<unknown> {
    const { api, ok } = modeApi();
    if (!ok || !api?.get) return undefined;
    try {
      return await withTimeout(api.get(), LOAD_TIMEOUT_MS, "mode.get");
    } catch (error) {
      log(`Session mode unavailable: ${describe(error)}`, "warning");
      return undefined;
    }
  }
  async function readCurrent(): Promise<CurrentModel | undefined> {
    const api = rpc().model;
    if (!api || !fn(api.getCurrent)) return undefined;
    try {
      return parseCurrentModel(
        await withTimeout(api.getCurrent!(), LOAD_TIMEOUT_MS, "model.getCurrent"),
      );
    } catch (error) {
      log(`Current model unavailable: ${describe(error)}`, "warning");
      return undefined;
    }
  }
  async function readModels(): Promise<ModelOption[] | undefined> {
    const api = rpc().model;
    if (!api || !fn(api.list)) return undefined;
    try {
      return parseModelList(await withTimeout(api.list!(), LOAD_TIMEOUT_MS, "model.list"));
    } catch (error) {
      log(`Model list unavailable: ${describe(error)}`, "warning");
      return undefined;
    }
  }

  // Validation and native invocation stay synchronous; the service owns serialization/read-back.
  function apply(
    change: ControlChange,
    controls: SessionControls,
    current: CurrentModel,
    mode: SessionMode | undefined,
    models: ModelOption[],
  ): Promise<unknown> {
    const active = current.modelId
      ? models.find((model) => model.id === current.modelId)
      : undefined;
    const { api: model } = modelApi();
    let call: Promise<unknown>;
    if ("mode" in change) {
      const { api } = modeApi();
      if (!controls.available.mode || !api?.set) throw unavailable("Mode can't be changed here.");
      // Refuse rather than overwrite a mode another client changed first.
      call = api.set({ mode: change.mode, ...(mode ? { expectedMode: mode } : {}) });
    } else if ("modelId" in change) {
      if (!controls.available.model || !model?.switchTo) {
        throw unavailable("The model can't be changed here.");
      }
      const target = models.find((option) => option.id === change.modelId);
      if (!target) throw invalid("That model is not available in this session.");
      // Keep only a supported effort; null clears an incompatible override.
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
    return withTimeout(Promise.resolve(call), APPLY_TIMEOUT_MS, "change");
  }
  return { modeApi, modelApi, readMode, readCurrent, readModels, apply };
}
