export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function makeError(code, message, extra = {}) {
    return { ok: false, code, message, ...extra };
}
export const isString = (value) => typeof value === "string";
export const isOptionalString = (value) => value === undefined || typeof value === "string";
export const isStringList = (value) => Array.isArray(value) && value.every(isString);
export function onlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
}
