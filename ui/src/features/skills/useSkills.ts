import { useEffect, useRef, useState } from "react";
import { fetchSkills } from "../../api";
import type { SkillSummary } from "../../shared";

const RECHECK_MS = 5 * 60_000;

/** Abort obsolete reads; the picker stays hidden when the session cannot list skills. */
export function useSkills(sessionId: string | undefined, refresh: boolean): SkillSummary[] | null {
  const [value, setValue] = useState<{ sessionId: string; skills: SkillSummary[] } | null>(null);
  const updated = useRef({ sessionId: "", at: 0 });
  useEffect(() => {
    if (!sessionId) return;
    const previous = updated.current;
    if (previous.sessionId === sessionId && (!refresh || Date.now() - previous.at < RECHECK_MS))
      return;
    const controller = new AbortController();
    void fetchSkills(controller.signal).then(
      (info) => {
        if (controller.signal.aborted) return;
        updated.current = { sessionId, at: Date.now() };
        setValue({ sessionId, skills: info.available ? info.skills : [] });
      },
      () => {
        if (!controller.signal.aborted) setValue(null);
      },
    );
    return () => controller.abort();
  }, [sessionId, refresh]);
  return value && value.sessionId === sessionId ? value.skills : null;
}
