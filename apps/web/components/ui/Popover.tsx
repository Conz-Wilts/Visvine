'use client';

// A floating panel anchored to a control — the rail's space and account menus,
// a table header's column menu. Opened by a CLICK on its anchor, never by the
// pointer passing over it: a menu that opens on hover needs a steady hand,
// does nothing on a touch screen, and is in the way of whatever the pointer
// was crossing to. The anchor's own handler toggles it; this component only
// draws it and knows how it closes.
//
// It portals to <body> at a fixed position, so a scroll box or a transformed
// container around the anchor cannot clip or drag it, and it closes the way a
// menu is expected to: a press anywhere outside it, Escape, a scroll outside
// it, a resize. Focus moves into it when it opens and back to the anchor when
// it closes; ArrowUp/ArrowDown walk its `role="menuitem"` controls, Home and
// End jump to the first and last.
//
// The anchor's box is watched, not read once: the rail widens under a menu
// opened from a shut rail, and the menu stays glued to the row's edge.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

export type PopoverPlacement =
  /** Under the anchor, left edges aligned. */
  | 'bottom-start'
  /** Beside the anchor on its right, top edges aligned. */
  | 'right-start'
  /** Beside the anchor on its right, bottom edges aligned. */
  | 'right-end';

const VIEWPORT_MARGIN = 8;
const GAP = 6;

function positionFor(
  r: DOMRect,
  placement: PopoverPlacement,
  width: number,
  height: number,
): { top: number; left: number } {
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
  const clamp = (v: number, max: number) => Math.max(VIEWPORT_MARGIN, Math.min(v, max));
  switch (placement) {
    case 'bottom-start':
      return { top: clamp(r.bottom + GAP, maxTop), left: clamp(r.left, maxLeft) };
    case 'right-start':
      return { top: clamp(r.top, maxTop), left: clamp(r.right + GAP, maxLeft) };
    case 'right-end':
      return { top: clamp(r.bottom - height, maxTop), left: clamp(r.right + GAP, maxLeft) };
  }
}

const MENU_ITEMS = '[role="menuitem"]:not([disabled])';

export default function Popover({
  anchor,
  onClose,
  placement = 'bottom-start',
  width = 248,
  role = 'menu',
  ariaLabel,
  autoFocus = true,
  className = '',
  children,
}: {
  /** The element the panel hangs from; the panel exists while this does. */
  anchor: HTMLElement | null;
  onClose: () => void;
  placement?: PopoverPlacement;
  width?: number;
  /** `menu` for a list of commands, `dialog` when it holds a field or a form. */
  role?: 'menu' | 'dialog';
  ariaLabel?: string;
  /** Move focus into the panel on open (the first `[autofocus]`, else the
   *  first menu item). Off when the caller manages focus itself. */
  autoFocus?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    setPos(positionFor(r, placement, width, h));
  }, [anchor, placement, width]);

  // Position once the panel has a height to measure, then follow the anchor
  // and the panel as either changes size.
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    place();
    const ro = new ResizeObserver(place);
    ro.observe(anchor);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [anchor, place]);

  // Focus in on open, back to the anchor on close.
  useEffect(() => {
    if (!anchor || !autoFocus) return;
    const panel = ref.current;
    const target =
      panel?.querySelector<HTMLElement>('[autofocus]') ?? panel?.querySelector<HTMLElement>(MENU_ITEMS);
    target?.focus({ preventScroll: true });
    return () => {
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        anchor.focus({ preventScroll: true });
      }
    };
  }, [anchor, autoFocus]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      const panel = ref.current;
      if (!panel || !panel.contains(document.activeElement)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEMS));
      if (items.length === 0) return;
      // A text field keeps Home/End for its caret; the arrows still leave it
      // for the list, which is what a search-then-pick menu wants.
      const inField = document.activeElement instanceof HTMLInputElement;
      if (inField && (e.key === 'Home' || e.key === 'End')) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % items.length)
        : i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
      items[next]?.focus();
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

  if (!anchor) return null;

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width,
        // Drawn off-screen for the first measure, so nothing flashes at 0,0.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={`dropdown-pop z-50 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-float ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

/** One command in a popover menu: a glyph cell, a label, an optional trailing
 *  mark. `href` makes it a link; otherwise it is a button. Rows are 40px and
 *  edge to edge inside the panel's padding, the way the rail's are inside the
 *  rail. */
export function PopoverItem({
  label,
  icon,
  href,
  onClick,
  trailing,
  current = false,
  indent = false,
  className = '',
  ...aria
}: {
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  /** The row that IS the current state (the space you are in): weight, not colour. */
  current?: boolean;
  /** One level in — a sub-space under its parent. */
  indent?: boolean;
  className?: string;
  'aria-haspopup'?: 'dialog' | 'menu';
  'aria-expanded'?: boolean;
}) {
  const cls = `flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] transition-colors hover:bg-surface-3 focus:outline-none focus-visible:bg-surface-3 ${
    current ? 'font-semibold text-text-primary' : 'font-normal text-text-primary'
  } ${indent ? "pl-11" : ""} ${className}`;
  const inner = (
    <>
      {icon !== undefined && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-text-secondary [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </>
  );
  return href ? (
    <Link href={href} role="menuitem" className={cls} onClick={onClick} {...aria}>
      {inner}
    </Link>
  ) : (
    <button type="button" role="menuitem" className={cls} onClick={onClick} {...aria}>
      {inner}
    </button>
  );
}

/** A hairline between groups of items. */
export function PopoverDivider() {
  return <div role="separator" className="my-1.5 border-t border-border-subtle" />;
}

/** A group's name, set small above its rows. */
export function PopoverHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </div>
  );
}
