const STEPS: Record<string, 1 | -1> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** Keys 1 to 9 label the first nine choices. */
export const MAX_NUMBERED = 9;

/**
 * Which choice a key moves to, or null when the key isn't one for choices. Arrows wrap around
 * (nothing focused yet: Down goes to the first, Up to the last); a digit goes to that choice.
 */
export function choiceTarget(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  const step = STEPS[key];
  if (step) return at < 0 ? (step > 0 ? 0 : count - 1) : (at + step + count) % count;
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < count ? index : null;
  }
  return null;
}
