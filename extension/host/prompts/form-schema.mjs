import { LIMITS } from "../../shared/contract.mjs";
import { clip, isRecord, optional, MAX_INTENT, MAX_LABEL, MAX_SUBJECT } from "./descriptions.mjs";
const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
/** Maps one flat schema property to a field; null when the canvas can't render it. */
function describeField(name, schema, required) {
    if (!isRecord(schema))
        return null;
    const label = clip(schema.title, MAX_LABEL) || clip(name, MAX_LABEL);
    const field = { name, label, type: "string", required };
    const description = optional(schema.description, MAX_INTENT);
    if (description)
        field.description = description;
    switch (schema.type) {
        case "boolean":
            field.type = "boolean";
            if (typeof schema.default === "boolean")
                field.default = schema.default;
            return field;
        case "number":
        case "integer":
            field.type = schema.type;
            if (finite(schema.minimum) !== undefined)
                field.minimum = schema.minimum;
            if (finite(schema.maximum) !== undefined)
                field.maximum = schema.maximum;
            if (finite(schema.default) !== undefined)
                field.default = schema.default;
            return field;
        case "string": {
            let options;
            if (Array.isArray(schema.enum)) {
                if (!schema.enum.every((value) => typeof value === "string"))
                    return null;
                const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
                options = schema.enum.map((value, index) => ({
                    value,
                    label: clip(typeof names[index] === "string" ? names[index] : value, MAX_LABEL),
                }));
            }
            else if (Array.isArray(schema.oneOf)) {
                if (!schema.oneOf.every((o) => isRecord(o) && typeof o.const === "string")) {
                    return null;
                }
                options = schema.oneOf.map((o) => ({
                    value: o.const,
                    label: clip(typeof o.title === "string" ? o.title : o.const, MAX_LABEL),
                }));
            }
            if (options) {
                if (options.length === 0 || options.length > LIMITS.maxChoices)
                    return null;
                field.type = "enum";
                field.options = options;
                if (typeof schema.default === "string" && options.some((o) => o.value === schema.default)) {
                    field.default = schema.default;
                }
                return field;
            }
            if (finite(schema.minLength) !== undefined)
                field.minLength = schema.minLength;
            if (finite(schema.maxLength) !== undefined)
                field.maxLength = schema.maxLength;
            if (typeof schema.default === "string")
                field.default = clip(schema.default, MAX_INTENT);
            return field;
        }
        default:
            return null;
    }
}
export function describeForm(requestId, createdAt, data) {
    const prompt = {
        kind: "form",
        requestId,
        createdAt,
        message: clip(data.message, LIMITS.maxPromptDetailChars) || "Copilot needs some details.",
        fields: [],
        supported: true,
    };
    const source = optional(data.elicitationSource, MAX_SUBJECT);
    if (source)
        prompt.source = source;
    if (data.mode === "url")
        return { ...prompt, supported: false };
    const schema = data.requestedSchema;
    if (schema === undefined)
        return prompt;
    if (!isRecord(schema) || !isRecord(schema.properties))
        return { ...prompt, supported: false };
    const required = new Set(Array.isArray(schema.required)
        ? schema.required.filter((n) => typeof n === "string")
        : []);
    const names = Object.keys(schema.properties);
    if (names.length > LIMITS.maxFormFields)
        return { ...prompt, supported: false };
    const fields = [];
    for (const name of names) {
        const field = describeField(name, schema.properties[name], required.has(name));
        if (!field)
            return { ...prompt, supported: false };
        fields.push(field);
    }
    return { ...prompt, fields };
}
