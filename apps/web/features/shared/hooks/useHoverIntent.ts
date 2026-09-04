'use client';

import { useCallback, useEffect, useRef } from 'react';

/** How long the pointer rests on a row before pointing at it counts. */
export const HOVER_INTENT_MS = 120;

/**
 * Pointing at a row that changes what is open — a rail row that swaps one
 * panel for another, a band row that puts the switcher away — must not fire
 * for a pointer merely passing across it on its way somewhere else. The
 * handlers this returns run `action` only once the pointer has rested on the
 * element for HOVER_INTENT_MS; leaving sooner cancels it. One timer serves
 * every element wrapped by the same hook, since the pointer is on one at a
 * time.
 */
export function useHoverIntent(delay = HOVER_INTENT_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return useCallback(
    (action: () => void) => ({
      onMouseEnter: () => {
        cancel();
        timer.current = setTimeout(() => {
          timer.current = null;
          action();
        }, delay);
      },
      onMouseLeave: cancel,
    }),
    [cancel, delay],
  );
}
