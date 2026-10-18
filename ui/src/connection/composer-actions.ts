// Read-only composer resources. Dictation never calls the host.
import {
  API,
  validateContextState,
  validateSkills,
  type ContextState,
  type SkillsInfo,
} from "../shared";
import { ApiError, getJson } from "./http";

export async function fetchSkills(signal?: AbortSignal): Promise<SkillsInfo> {
  const body = await getJson<unknown>(API.skills, signal);
  if (!validateSkills(body)) throw new ApiError("invalid_response", "The skill list is unusable.");
  return body;
}

export async function fetchContextUsage(signal?: AbortSignal): Promise<ContextState> {
  const body = await getJson<unknown>(API.context, signal);
  if (!validateContextState(body))
    throw new ApiError("invalid_response", "Context usage is unavailable.");
  return body;
}
