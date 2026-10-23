import { describe, expect, it, vi } from "vite-plus/test";
import { recoverStalePage, STALE_RELOAD_COOLDOWN_MS } from "../../ui/src/connection/staleReload.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

describe("recoverStalePage", () => {
  it("reloads once, then waits out the cooldown before reloading again", () => {
    const storage = memory();
    const reload = vi.fn();
    let now = 1_000_000;
    const deps = { storage, reload, now: () => now };
    expect(recoverStalePage(deps)).toBe(true);
    now += STALE_RELOAD_COOLDOWN_MS - 1;
    expect(recoverStalePage(deps)).toBe(false);
    now += 1;
    expect(recoverStalePage(deps)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when the guard cannot be saved", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(recoverStalePage({ storage, reload, now: () => 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
