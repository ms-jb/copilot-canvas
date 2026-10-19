import { API, validateSessions, type SessionsInfo } from "../shared";
import { ApiError, getJson } from "./http";

export async function fetchSessions(signal?: AbortSignal): Promise<SessionsInfo> {
  const body = await getJson<unknown>(API.sessions, signal);
  if (!validateSessions(body)) {
    throw new ApiError("invalid_response", "The provider sent an incompatible session list.");
  }
  return body;
}
