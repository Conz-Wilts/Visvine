'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `handler` when the Escape key is pressed. The latest `handler` is
 * invoked via a ref so an inline closure is safe. Pass `enabled = false` to
 * detach the listener (e.g. while a modal is closed).
 */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handlerRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
