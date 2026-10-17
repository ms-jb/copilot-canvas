/** Checks one form submission against the prompt's fields and returns the values to send. */
export function checkFormValues(prompt, values = {}) {
    const byName = new Map(prompt.fields.map((field) => [field.name, field]));
    const content = {};
    for (const name of Object.keys(values)) {
        if (!byName.has(name))
            return "The answer has a field this request doesn't ask for.";
    }
    for (const field of prompt.fields) {
        const value = Object.prototype.hasOwnProperty.call(values, field.name)
            ? values[field.name]
            : undefined;
        const empty = value === undefined || (typeof value === "string" && value.trim() === "");
        if (empty) {
            if (field.required)
                return `${field.label} is required.`;
            continue;
        }
        switch (field.type) {
            case "boolean":
                if (typeof value !== "boolean")
                    return `${field.label} must be yes or no.`;
                break;
            case "number":
            case "integer":
                if (typeof value !== "number" || (field.type === "integer" && !Number.isInteger(value))) {
                    return `${field.label} must be ${field.type === "integer" ? "a whole number" : "a number"}.`;
                }
                if (field.minimum !== undefined && value < field.minimum) {
                    return `${field.label} must be at least ${field.minimum}.`;
                }
                if (field.maximum !== undefined && value > field.maximum) {
                    return `${field.label} must be at most ${field.maximum}.`;
                }
                break;
            case "enum":
                if (typeof value !== "string" || !field.options?.some((o) => o.value === value)) {
                    return `${field.label} must be one of the listed options.`;
                }
                break;
            default:
                if (typeof value !== "string")
                    return `${field.label} must be text.`;
                if (field.minLength !== undefined && value.length < field.minLength) {
                    return `${field.label} is too short.`;
                }
                if (field.maxLength !== undefined && value.length > field.maxLength) {
                    return `${field.label} is too long.`;
                }
        }
        Object.defineProperty(content, field.name, { value, enumerable: true, writable: true });
    }
    return content;
}
