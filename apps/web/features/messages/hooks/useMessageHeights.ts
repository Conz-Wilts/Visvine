import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateMessageHeight, type MessageHeightOptions } from '@/lib/messages/pretext';
import type { SerializedMessage } from '@/lib/messages/types';

/**
 * Hook that pre-computes message heights using pretext (canvas-based, no DOM reflow).
 *
 * Returns a `getItemHeight` function suitable for Virtuoso's itemSize prop,
 * plus the heights array for direct access.
 *
 * Heights are recalculated on:
 * - Messages array change (new/edited/deleted messages)
 * - Container width change (window resize)
 * - Mobile breakpoint change
 */
export function useMessageHeights(
  messages: SerializedMessage[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  isMobile: boolean,
) {
  const [containerWidth, setContainerWidth] = useState(0);
  const heightsRef = useRef<Map<string, number>>(new Map());

  // Track container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && Math.abs(width - containerWidth) > 1) {
        setContainerWidth(width);
      }
    });

    observer.observe(el);
    setContainerWidth(el.clientWidth);

    return () => observer.disconnect();
  }, [containerRef, containerWidth]);

  // Recalculate heights when messages or dimensions change
  const heights = useMemo(() => {
    if (containerWidth === 0) return new Map<string, number>();

    const options: MessageHeightOptions = { containerWidth, isMobile };
    const map = new Map<string, number>();

    for (const msg of messages) {
      // Check if we have a cached height and the message hasn't changed
      const cacheKey = `${msg.id}:${msg.editedAt ?? ''}:${msg.deletedAt ?? ''}:${msg.reactions?.length ?? 0}:${msg.images?.length ?? 0}`;
      const existing = heightsRef.current.get(cacheKey);

      if (existing !== undefined) {
        map.set(msg.id, existing);
      } else {
        const h = calculateMessageHeight(msg, options);
        map.set(msg.id, h);
        heightsRef.current.set(cacheKey, h);
      }
    }

    return map;
  }, [messages, containerWidth, isMobile]);

  // Virtuoso-compatible height getter: returns pre-calculated height for a given index
  const getItemHeight = useCallback(
    (index: number) => {
      const msg = messages[index];
      if (!msg) return 60; // fallback
      return heights.get(msg.id) ?? 60;
    },
    [messages, heights],
  );

  // Clear caches on unmount. The ref is captured here rather than read in the
  // cleanup so we clear the map this mount owned, not whatever it points at later.
  useEffect(() => {
    const cache = heightsRef.current;
    return () => {
      cache.clear();
    };
  }, []);

  return { heights, getItemHeight, containerWidth };
}
