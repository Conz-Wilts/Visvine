import { useCallback, useEffect, useRef } from 'react';

type Positions = Record<string, { x: number; y: number }>;
type Transform = { x: number; y: number; k: number };

/**
 * Owns "when do we persist the graph layout?" for CustomForceGraph.
 *
 * One flag + one debounce, replacing what used to be three bare refs and a timer
 * scattered across the canvas component:
 *  - markDirty()      — a cold run or a node drag changed the layout; the next
 *                       sim settle should persist it.
 *  - markRestored()   — the current positions are a frozen restore; do NOT
 *                       persist them straight back.
 *  - flushOnSettle()  — call when the sim settles; persists once iff the layout
 *                       was dirtied, then clears the flag.
 *  - schedulePersist()— debounced persist for camera-only changes (pan/zoom)
 *                       that don't restart the simulation.
 *
 * The returned callbacks are referentially stable, so callers can safely list
 * them in effect/callback dependency arrays.
 */
export function useLayoutPersistence(
  onPersistLayout?: (positions: Positions, transform: Transform) => void,
) {
  const onPersistRef = useRef(onPersistLayout);
  onPersistRef.current = onPersistLayout;

  const persistOnSettleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const markDirty = useCallback(() => { persistOnSettleRef.current = true; }, []);
  const markRestored = useCallback(() => { persistOnSettleRef.current = false; }, []);

  const flushOnSettle = useCallback((positions: Positions, transform: Transform) => {
    if (persistOnSettleRef.current && onPersistRef.current) {
      persistOnSettleRef.current = false;
      onPersistRef.current(positions, transform);
    }
  }, []);

  const schedulePersist = useCallback(
    (getPositions: () => Positions, getTransform: () => Transform) => {
      if (!onPersistRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onPersistRef.current?.(getPositions(), getTransform());
      }, 1000);
    },
    [],
  );

  return { markDirty, markRestored, flushOnSettle, schedulePersist };
}
