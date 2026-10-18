import { CONTEXT_TIERS, SESSION_MODES, isPlainObject } from "../../shared/contract.mts";
import type { ContextTier, ModelOption, SessionMode } from "../../shared/contract.mts";

const MAX_MODELS = 200;
const MAX_NAME_LENGTH = 120;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
export const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;

export interface CurrentModel {
  modelId?: string;
  reasoningEffort?: string;
  contextTier?: ContextTier;
}

export function isMode(value: unknown): value is SessionMode {
  return SESSION_MODES.includes(value as SessionMode);
}
export function isTier(value: unknown): value is ContextTier {
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

function record(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}
function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Providers declare tiers or publish long-context pricing. The standard window is always paired
 * with long_context; no other tiers are invented. `session.model.list` returns raw catalog
 * entries (snake_case `billing.token_prices.long_context`); the curated `models.list` shape is
 * camelCase (`billing.tokenPrices.longContext`). Both are read.
 */
function contextOf(
  model: Record<string, unknown>,
): Pick<ModelOption, "contextTiers" | "contextTokens"> {
  const declared = stringList(
    model.supportedContextTiers ?? model.supported_context_tiers,
    /^[a-z_]{1,32}$/,
  ).filter(isTier);
  const billing = record(model.billing);
  const prices = record(billing?.tokenPrices ?? billing?.token_prices);
  const standard = record(prices?.default) ?? prices;
  const long = record(prices?.longContext ?? prices?.long_context);
  if (!declared.includes("long_context") && !long) return {};
  const tokens: Partial<Record<ContextTier, number>> = {};
  const standardTokens = tokenCount(standard?.maxPromptTokens ?? standard?.max_prompt_tokens);
  const longTokens = tokenCount(long?.maxPromptTokens ?? long?.max_prompt_tokens);
  if (standardTokens) tokens.default = standardTokens;
  if (longTokens) tokens.long_context = longTokens;
  return {
    contextTiers: ["default", "long_context"],
    ...(Object.keys(tokens).length > 0 ? { contextTokens: tokens } : {}),
  };
}

export function toModelOption(value: unknown): ModelOption | null {
  if (!isPlainObject(value)) return null;
  const { id, name } = value;
  if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id)) return null;
  if (isPlainObject(value.policy) && value.policy.state === "disabled") return null;
  const label = typeof name === "string" && name.trim() ? name.trim() : id;
  const option: ModelOption = { id, name: label.slice(0, MAX_NAME_LENGTH) };
  // Curated lists and raw catalog entries place reasoning efforts at different paths.
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
  return { ...option, ...contextOf(value) };
}

export function parseModelList(value: unknown): ModelOption[] {
  const list = isPlainObject(value) && Array.isArray(value.list) ? value.list : [];
  const models: ModelOption[] = [];
  for (const item of list) {
    const option = toModelOption(item);
    if (option && !models.some((existing) => existing.id === option.id)) models.push(option);
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

export function parseCurrentModel(model: unknown): CurrentModel | undefined {
  if (!isPlainObject(model)) return undefined;
  const next: CurrentModel = {};
  if (typeof model.modelId === "string" && model.modelId) next.modelId = model.modelId;
  if (typeof model.reasoningEffort === "string" && EFFORT_PATTERN.test(model.reasoningEffort)) {
    next.reasoningEffort = model.reasoningEffort;
  }
  if (isTier(model.contextTier)) next.contextTier = model.contextTier;
  return next;
}
