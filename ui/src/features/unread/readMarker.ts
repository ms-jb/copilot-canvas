import { useCallback, useSyncExternalStore } from "react";
import { STORAGE_PREFIX } from "../../layout/usePersistentFlag";
import { parseMarker, type ReadMarker } from "./model";

// Per device, per browser: the marker lives in localStorage under the same prefix as the shell's
// other remembered flags, and a second tab of the same app follows the first.
const KEY = `${STORAGE_PREFIX}chat-read`;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

// An in-memory copy when storage is blocked (private mode, a locked-down webview).
let memory = "";
const snapshot = () => readRaw() || memory;

// `getSnapshot` must be stable between calls: parse once per stored text.
let lastRaw: string | undefined;
let last: ReadMarker | null = null;
function marker(): ReadMarker | null {
  const raw = snapshot();
  if (raw !== lastRaw) {
    lastRaw = raw;
    last = parseMarker(raw) ?? null;
  }
  return last;
}

/** The last chat entry this device has read; null until the first transcript arrives. */
export function useReadMarker(): [ReadMarker | null, (next: ReadMarker) => void] {
  const value = useSyncExternalStore(subscribe, marker, () => null);
  const set = useCallback((next: ReadMarker) => {
    memory = JSON.stringify(next);
    try {
      window.localStorage.setItem(KEY, memory);
    } catch {
      // Kept in memory only.
    }
    notify();
  }, []);
  return [value, set];
}
