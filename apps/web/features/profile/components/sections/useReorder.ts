'use client';

/**
 * Rearranging a list of rows by grabbing one.
 *
 * The rows carry `data-row-key`; a grip holds the pointer and the keyboard.
 * While a row is held the order is local, so the list follows the pointer
 * without a round trip; letting go commits the order once. Arrow keys move the
 * held row one place, which is the same act without a pointer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** The order with `id` moved `delta` places, clamped to the ends. */
function moveId(order: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  if (to === from) return [...order];
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function useReorder<E extends HTMLElement = HTMLDivElement>(
  ids: string[],
  commit: (order: string[]) => void,
) {
  const [order, setOrder] = useState<string[]>(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const rootRef = useRef<E | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // The server's order wins whenever it changes under us — except mid-drag,
  // when the pointer is the authority. The list itself is a fresh array on
  // every render, so what is watched is the ids themselves.
  const idKey = ids.join('\u0000');
  useEffect(() => {
    if (!dragging) setOrder(idsRef.current);
  }, [idKey, dragging]);

  const rowAt = useCallback((clientY: number): string | null => {
    const rows = rootRef.current?.querySelectorAll<HTMLElement>('[data-row-key]');
    if (!rows) return null;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (clientY >= box.top && clientY <= box.bottom) return row.dataset.rowKey ?? null;
    }
    return null;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const over = rowAt(e.clientY);
    if (!over || over === dragging) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragging);
      const to = next.indexOf(over);
      if (from < 0 || to < 0) return prev;
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  }, [dragging, rowAt]);

  const end = useCallback(() => {
    if (!dragging) return;
    setDragging(null);
    commit(orderRef.current);
  }, [dragging, commit]);

  const gripProps = useCallback((id: string) => ({
    'aria-label': 'Reorder',
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragging(id);
    },
    onPointerUp: end,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const next = moveId(orderRef.current, id, e.key === 'ArrowUp' ? -1 : 1);
      setOrder(next);
      commit(next);
    },
  }), [commit, end]);

  return {
    order,
    dragging,
    /** Spread on the element that wraps every row. */
    listProps: { ref: rootRef, onPointerMove, onPointerUp: end, onPointerLeave: end },
    /** Spread on each row. */
    rowProps: (id: string) => ({ 'data-row-key': id }),
    gripProps,
  };
}
