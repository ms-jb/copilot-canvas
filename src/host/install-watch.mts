import { statSync, unwatchFile, watchFile, type Stats } from "node:fs";

/** The install marker's modification time, or 0 when there is none. */
export function markerTime(markerPath: string): number {
  try {
    return statSync(markerPath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Calls `onInstall` when `npm run install-ext` swaps a new build into this extension's folder. The
 * install marker is written with the build, so a changed marker means the whole build is in place.
 * `baseline` is the marker time read when this code loaded: a build that landed while the
 * extension was still starting is caught when watching begins. Polling (not fs.watch) survives the
 * folder being replaced, and never keeps the process alive.
 */
export function watchInstall(
  markerPath: string,
  onInstall: () => void,
  { baseline, intervalMs = 1500 }: { baseline?: number; intervalMs?: number } = {},
): () => void {
  const listener = (current: Stats, previous: Stats) => {
    if (current.mtimeMs > 0 && current.mtimeMs !== previous.mtimeMs) onInstall();
  };
  watchFile(markerPath, { interval: intervalMs, persistent: false }, listener);
  const now = markerTime(markerPath);
  if (baseline !== undefined && now > 0 && now !== baseline) onInstall();
  return () => unwatchFile(markerPath, listener);
}
