const MARKER = "companion.stale-reload.v1";
export const STALE_RELOAD_COOLDOWN_MS = 60_000;

interface Deps {
  storage: Pick<Storage, "getItem" | "setItem">;
  now: () => number;
  reload: () => void;
}

/**
 * A remote page (phone or other browser through the gateway) that went stale reloads itself once to
 * pick up the restarted provider's current client, instead of waiting for a tap. A timestamp in
 * session storage allows at most one automatic reload per minute, so a provider that stays broken
 * leaves the banner and its Reload button rather than a reload loop. Returns whether it reloaded.
 */
export function recoverStalePage({ storage, now, reload }: Deps): boolean {
  try {
    const previous = Number(storage.getItem(MARKER));
    const at = now();
    if (Number.isFinite(previous) && previous > 0 && at - previous < STALE_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(MARKER, String(at));
  } catch {
    // Without a durable marker a fresh page could repeat the same failure forever.
    return false;
  }
  reload();
  return true;
}
