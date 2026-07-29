// Determinism utilities: the seeded PRNG every random draw in the engine flows
// through, plus the clock and event-loop yield the async driver uses.

export function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

export function yieldToEventLoop(): Promise<void> {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => void;
    setTimeout: (cb: () => void, ms: number) => void;
    document?: { visibilityState?: string };
  };
  // requestAnimationFrame aligns snapshot emission with paint frames, but
  // browsers suspend rAF entirely in hidden tabs — a layout started in a
  // background tab would never finish. Only use rAF when actually visible.
  const visible = g.document?.visibilityState === 'visible';
  return new Promise((resolve) =>
    visible && typeof g.requestAnimationFrame === 'function'
      ? g.requestAnimationFrame(() => resolve())
      : g.setTimeout(resolve, 0),
  );
}

/** FNV-1a 32-bit string hash — stable seed derivation from context identity. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — tiny, fast, passes gjrand; 2^32 period is far beyond the
 * <10^6 draws a layout makes. All engine randomness flows through one
 * instance so identical inputs give identical layouts.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
