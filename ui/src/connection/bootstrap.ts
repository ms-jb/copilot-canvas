import { API, validateBootstrap, validateIdentity, type Bootstrap, type Identity } from "../shared";
import { ApiError, getJson } from "./http";

export async function fetchBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  const body = await getJson<unknown>(API.bootstrap, signal);
  if (!validateBootstrap(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible bootstrap response.");
  }
  return body;
}

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity> {
  const body = await getJson<unknown>(API.identity, signal);
  if (!validateIdentity(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible identity response.");
  }
  return body;
}
