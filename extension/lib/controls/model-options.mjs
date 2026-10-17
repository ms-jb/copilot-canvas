import { CONTEXT_TIERS, SESSION_MODES, isPlainObject } from "../../shared/contract.mjs";
const MAX_MODELS = 200;
const MAX_NAME_LENGTH = 120;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
export const EFFORT_PATTERN = /^[a-z_-]{1,32}$/;
export function isMode(value) {
    return SESSION_MODES.includes(value);
}
export function isTier(value) {
    return CONTEXT_TIERS.includes(value);
}
function stringList(value, pattern) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (typeof item === "string" && pattern.test(item) && !out.includes(item))
            out.push(item);
    }
    return out;
}
/**
 * Providers declare tiers or publish long-context pricing. The standard window is always paired
 * with long_context; no other tiers are invented.
 */
function contextTiersOf(model) {
    const declared = stringList(model.supportedContextTiers, /^[a-z_]{1,32}$/).filter(isTier);
    const billing = isPlainObject(model.billing) ? model.billing : null;
    const prices = billing && isPlainObject(billing.tokenPrices) ? billing.tokenPrices : null;
    const priced = prices !== null && isPlainObject(prices.longContext);
    if (!declared.includes("long_context") && !priced)
        return [];
    return ["default", "long_context"];
}
export function toModelOption(value) {
    if (!isPlainObject(value))
        return null;
    const { id, name } = value;
    if (typeof id !== "string" || !MODEL_ID_PATTERN.test(id))
        return null;
    if (isPlainObject(value.policy) && value.policy.state === "disabled")
        return null;
    const label = typeof name === "string" && name.trim() ? name.trim() : id;
    const option = { id, name: label.slice(0, MAX_NAME_LENGTH) };
    // Curated lists and raw catalog entries place reasoning efforts at different paths.
    const capabilities = isPlainObject(value.capabilities) ? value.capabilities : null;
    const supports = capabilities && isPlainObject(capabilities.supports) ? capabilities.supports : null;
    const efforts = stringList(Array.isArray(value.supportedReasoningEfforts)
        ? value.supportedReasoningEfforts
        : supports?.reasoning_effort, EFFORT_PATTERN);
    if (efforts.length > 0) {
        option.reasoningEfforts = efforts;
        if (typeof value.defaultReasoningEffort === "string" &&
            efforts.includes(value.defaultReasoningEffort)) {
            option.defaultReasoningEffort = value.defaultReasoningEffort;
        }
    }
    const tiers = contextTiersOf(value);
    if (tiers.length > 0)
        option.contextTiers = tiers;
    return option;
}
export function parseModelList(value) {
    const list = isPlainObject(value) && Array.isArray(value.list) ? value.list : [];
    const models = [];
    for (const item of list) {
        const option = toModelOption(item);
        if (option && !models.some((existing) => existing.id === option.id))
            models.push(option);
        if (models.length >= MAX_MODELS)
            break;
    }
    return models;
}
export function parseCurrentModel(model) {
    if (!isPlainObject(model))
        return undefined;
    const next = {};
    if (typeof model.modelId === "string" && model.modelId)
        next.modelId = model.modelId;
    if (typeof model.reasoningEffort === "string" && EFFORT_PATTERN.test(model.reasoningEffort)) {
        next.reasoningEffort = model.reasoningEffort;
    }
    if (isTier(model.contextTier))
        next.contextTier = model.contextTier;
    return next;
}
