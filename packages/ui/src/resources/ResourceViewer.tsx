'use client';

import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '../Avatar';
import IconButton from '../IconButton';
import Menu, { type MenuItem } from '../Menu';
import { FOCUS_RING } from '../focus';
import FileTypeIcon from './FileTypeIcon';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../icons';

export interface ViewerAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface ResourceViewerProps {
  open: boolean;
  /** `panel`: a side sheet beside the page. `full`: the whole window. */
  mode: 'panel' | 'full';
  onModeChange: (mode: 'panel' | 'full') => void;
  onClose: () => void;
  title: string;
  kind: string;
  /** One muted line: `Ana · in #brand · 3d · PDF · 2.1 MB`. */
  meta?: string;
  person?: { name: string; imageUrl?: string | null } | null;
  /** The one labelled action: Download, Open in Google Sheets. */
  primary?: ViewerAction | null;
  /** Icon buttons beside it: Share, Copy link. */
  actions?: ViewerAction[];
  /** The overflow: View in context, Open in app, Delete. */
  menu?: MenuItem[];
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** `3 of 12`, when the viewer walks a list. */
  position?: string | null;
  zoom?: { label: string; onIn: () => void; onOut: () => void; onReset: () => void } | null;
  /** A rail beside the stage in full mode (a PDF's pages). */
  rail?: ReactNode;
  children: ReactNode;
}

function typingInto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * The resources viewer — Slack's flexpane grown into its file viewer. Beside
 * the page as a side sheet, or the whole window; the stage is the caller's
 * renderer. Keys: ← → walk the list, Esc closes, f toggles full, + − 0
 * zoom; a click on the full screen's backdrop closes it too. Focus moves in on open and back out on close.
 */
export default function ResourceViewer({
  open,
  mode,
  onModeChange,
  onClose,
  title,
  kind,
  meta,
  person,
  primary,
  actions = [],
  menu = [],
  onPrev,
  onNext,
  position,
  zoom,
  rail,
  children,
}: ResourceViewerProps) {
  const [mounted, setMounted] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    shell.current?.focus({ preventScroll: true });
    return () => {
      (returnTo.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typingInto(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === 'f') {
        e.preventDefault();
        onModeChange(mode === 'full' ? 'panel' : 'full');
      } else if (zoom && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoom.onIn();
      } else if (zoom && e.key === '-') {
        e.preventDefault();
        zoom.onOut();
      } else if (zoom && e.key === '0') {
        e.preventDefault();
        zoom.onReset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, onModeChange, onClose, onPrev, onNext, zoom]);

  if (!open || !mounted) return null;
  const full = mode === 'full';

  const modeAndClose = (
    <>
      <IconButton
        label={full ? 'Side panel' : 'Full screen'}
        icon={full ? <Minimize2Icon /> : <Maximize2Icon />}
        onClick={() => onModeChange(full ? 'panel' : 'full')}
      />
      <IconButton label="Close" icon={<XIcon />} onClick={onClose} />
    </>
  );

  const toolbar = (
    <div className="flex shrink-0 items-center gap-0.5">
      {zoom && full && (
        <div className="mr-1 flex items-center gap-0.5">
          <IconButton label="Zoom out" icon={<ZoomOutIcon />} onClick={zoom.onOut} />
          <button type="button" onClick={zoom.onReset} className={clsx('min-w-12 rounded-md px-1.5 py-1 text-xs tabular-nums text-fg-muted hover:bg-surface-muted hover:text-fg', FOCUS_RING)}>
            {zoom.label}
          </button>
          <IconButton label="Zoom in" icon={<ZoomInIcon />} onClick={zoom.onIn} />
        </div>
      )}
      {primary && (
        <button
          type="button"
          onClick={primary.onSelect}
          className={clsx(
            'mr-1 inline-flex items-center gap-1.5 rounded-lg bg-surface-subtle px-2.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted [&>svg]:h-4 [&>svg]:w-4',
            FOCUS_RING,
          )}
        >
          {primary.icon}
          <span className="hidden sm:inline">{primary.label}</span>
        </button>
      )}
      {actions.map((action) => (
        <IconButton key={action.id} label={action.label} icon={action.icon} onClick={action.onSelect} />
      ))}
      {menu.length > 0 && (
        <Menu
          label="More"
          items={menu}
          trigger={({ open: menuOpen, toggle }) => (
            <IconButton label="More" icon={<EllipsisIcon />} active={menuOpen} onClick={toggle} />
          )}
        />
      )}
      {full && (
        <>
          <span className="mx-1 h-5 w-px bg-line-subtle" aria-hidden="true" />
          {modeAndClose}
        </>
      )}
    </div>
  );

  // Full screen reads across one row; the side panel is narrow, so its title
  // gets the whole first row and the actions sit on a second.
  const header = full ? (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
      {person ? <Avatar name={person.name} imageUrl={person.imageUrl ?? null} size="sm" /> : <FileTypeIcon kind={kind} size="sm" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">{title}</p>
        {meta && <p className="truncate text-xs text-fg-muted">{meta}</p>}
      </div>
      {toolbar}
    </div>
  ) : (
    <div className="shrink-0 border-b border-line-subtle">
      <div className="flex items-start gap-3 px-3 pt-3">
        <FileTypeIcon kind={kind} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5 text-fg">{title}</p>
          {meta && <p className="truncate text-xs text-fg-muted">{meta}</p>}
        </div>
        <div className="-mt-1 flex shrink-0 items-center gap-0.5">{modeAndClose}</div>
      </div>
      <div className="flex items-center px-2 pb-2 pt-2">{toolbar}</div>
    </div>
  );

  const walk = (onPrev || onNext) && (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        {onPrev && (
          <IconButton
            label="Previous"
            icon={<ChevronLeftIcon />}
            onClick={onPrev}
            className="pointer-events-auto bg-surface shadow-float hover:bg-surface"
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
        {onNext && (
          <IconButton
            label="Next"
            icon={<ChevronRightIcon />}
            onClick={onNext}
            className="pointer-events-auto bg-surface shadow-float hover:bg-surface"
          />
        )}
      </div>
      {position && full && (
        <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface px-2.5 py-0.5 text-xs tabular-nums text-fg-muted shadow-float">
          {position}
        </span>
      )}
    </>
  );

  return createPortal(
    <div
      className={clsx(
        'fixed z-(--vv-z-modal) flex',
        full ? 'inset-0 bg-black/30' : 'inset-y-0 right-0 w-full sm:w-[28rem] lg:w-[30rem]',
      )}
      onClick={full ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div
        ref={shell}
        tabIndex={-1}
        role="dialog"
        aria-modal={full || undefined}
        aria-label={title}
        className={clsx(
          'flex h-full w-full flex-col bg-surface outline-none',
          full ? 'm-0 sm:m-4 sm:h-[calc(100%-2rem)] sm:rounded-2xl sm:shadow-float overflow-hidden' : 'border-l border-line-subtle shadow-float',
        )}
      >
        {header}
        <div className="flex min-h-0 flex-1">
          {full && rail && <div className="hidden w-44 shrink-0 overflow-y-auto border-r border-line-subtle bg-surface lg:block">{rail}</div>}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-muted">
            {children}
            {walk}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
