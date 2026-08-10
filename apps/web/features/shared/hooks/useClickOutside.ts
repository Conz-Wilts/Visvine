'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `handler` when a `mousedown` lands outside `ref`. The listener is
 * attached once for the life of the component (matching the hand-rolled
 * versions this replaces); the latest `handler` is always invoked via a ref, so
 * passing an inline closure does not re-attach the listener every render.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) handlerRef.current();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [ref]);
}
