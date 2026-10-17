import { useEffect, useState } from "react";
import { fetchSessions } from "../../api";
import type { SessionsInfo } from "../../shared";
import type { Connection } from "../../useConnection";

const hidden = () => document.visibilityState === "hidden";

export function useSessions(connection: Connection) {
  const [data, setData] = useState<SessionsInfo | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { phase } = connection;
  const sessionId = connection.context?.sessionId;
  const generation = connection.context?.generation;
  const active = phase === "connected";

  useEffect(() => {
    if (!active || !sessionId) return;
    let disposed = false;
    let controller: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      if (disposed || hidden() || controller) return;
      const request = new AbortController();
      controller = request;
      deadline = setTimeout(() => request.abort(), 8000);
      try {
        const result = await fetchSessions(request.signal);
        if (disposed || request.signal.aborted) return;
        if (result.sessionId !== sessionId) {
          connection.markStale();
          return;
        }
        setData((previous) =>
          result.source === "unavailable" && previous?.sessionId === sessionId ? previous : result,
        );
        setError(result.source === "unavailable");
      } catch {
        if (!disposed && !hidden()) setError(true);
      } finally {
        clearTimeout(deadline);
        if (controller === request) controller = undefined;
      }
    }
    const focus = () => {
      void read();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") controller?.abort();
      else focus();
    };
    focus();
    const interval = setInterval(focus, 30_000);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(deadline);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, sessionId, generation, refresh, connection.markStale]);

  return {
    data: data?.sessionId === sessionId ? data : null,
    stale: error || !active,
    retry: () => setRefresh((value) => value + 1),
  };
}
