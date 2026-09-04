'use client';

// A floating panel anchored under a table-header control. The table is its
// own scroll box, so a menu rendered inside it would be clipped by the
// scroller and dragged along by a horizontal scroll; the panel portals to
// the body at a fixed position instead, and closes on any scroll outside
// itself — a header menu is a quick stop, not a companion.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function HeaderPopover({
  anchor,
  onClose,
  width = 248,
  children,
}: {
  /** The element the panel hangs from; the panel exists while this does. */
  anchor: HTMLElement | null;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
  }, [anchor, width]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!anchor || !pos) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
      className="z-50 overflow-hidden rounded-xl bg-surface-1 py-1.5 shadow-float"
    >
      {children}
    </div>,
    document.body,
  );
}
