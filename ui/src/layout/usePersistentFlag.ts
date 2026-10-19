import { useCallback, useState } from "react";

const PREFIX = "copilot-companion:";

function read(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(PREFIX + key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

/** A boolean remembered in localStorage under `copilot-companion:<key>`; storage failures are ignored. */
export function usePersistentFlag(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(PREFIX + key, String(next));
      } catch {
        // Private mode or a locked-down webview: keep the in-memory value only.
      }
    },
    [key],
  );
  return [value, update];
}
