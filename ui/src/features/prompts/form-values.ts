import type { FormPrompt, FormValue } from "../../shared";

export function initialValues(prompt: FormPrompt): Record<string, FormValue> {
  return Object.fromEntries(
    prompt.fields.map((field) => [
      field.name,
      field.default ?? (field.type === "boolean" ? false : ""),
    ]),
  );
}

export function hasMissingValues(prompt: FormPrompt, values: Record<string, FormValue>): boolean {
  return prompt.fields.some(
    (field) => field.required && field.type !== "boolean" && values[field.name] === "",
  );
}

/** Serialize only described fields; native validation remains authoritative for constraints. */
export function answerValues(
  prompt: FormPrompt,
  values: Record<string, FormValue>,
): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const field of prompt.fields) {
    const value = values[field.name];
    if (value === "" || value === undefined) continue;
    const numeric = field.type === "number" || field.type === "integer";
    out[field.name] = numeric && Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return out;
}
