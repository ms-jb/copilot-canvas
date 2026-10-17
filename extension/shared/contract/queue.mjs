import { isPlainObject } from "./validation.mjs";
export function validateQueueState(value) {
    return (isPlainObject(value) &&
        Array.isArray(value.removedRequestIds) &&
        value.removedRequestIds.length <= 500 &&
        value.removedRequestIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id)));
}
