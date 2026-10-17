export type ValidationFailure = { ok: false; code: string; message: string };
export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function makeError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ValidationFailure & Record<string, unknown> {
  return { ok: false, code, message, ...extra };
}

export const isString = (value: unknown): value is string => typeof value === "string";
export const isOptionalString = (value: unknown) =>
  value === undefined || typeof value === "string";
export const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
