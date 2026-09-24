'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { panBy, wheelFactor, zoomAt, type ZoomState } from './zoomMath';

/**
 * Content that zooms toward the cursor (ctrl/⌘ + wheel, or a trackpad pinch)
 * and pans by dragging — only once it is zoomed past fitting, so a drag on a
 * fitted image never moves it. The state is the caller's (the viewer's
 * zoom buttons and keys drive the same numbers).
 */
export default function ZoomPane({
  state,
  onChange,
  max,
  contentSize,
  children,
  className,
}: {
  state: ZoomState;
  onChange: (next: ZoomState) => void;
  max: number;
  /** The content's drawn size at 1×, for bounding the pan. */
  contentSize: { width: number; height: number } | null;
  children: ReactNode;
  className?: string;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // A drag follows the pointer exactly; only a zoom step eases.
  const [dragging, setDragging] = useState(false);

  const centreOffset = useCallback((clientX: number, clientY: number) => {
    const box = pane.current!.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  }, []);

  return (
    <div
      ref={pane}
      className={clsx(
        'relative flex h-full w-full items-center justify-center overflow-hidden select-none',
        state.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
        className,
      )}
      onWheel={(e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        onChange(zoomAt(state, state.scale * wheelFactor(e.deltaY), centreOffset(e.clientX, e.clientY), max));
      }}
      onDoubleClick={(e) =>
        onChange(state.scale > 1 ? { scale: 1, x: 0, y: 0 } : zoomAt(state, 2, centreOffset(e.clientX, e.clientY), max))
      }
      onPointerDown={(e) => {
        if (state.scale <= 1 || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current || !contentSize || !pane.current) return;
        const box = pane.current.getBoundingClientRect();
        onChange(panBy(state, e.clientX - drag.current.x, e.clientY - drag.current.y, contentSize, box));
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div
        className={clsx('will-change-transform', !dragging && 'transition-transform duration-150 ease-standard')}
        style={{ transform: `translate(${state.x}px, ${state.y}px) scale(${state.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
