'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// Viewport-scaled width presets: never narrower than the old fixed caps, grow
// as a share of screen width on large monitors, with a sane upper bound.
const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'max-w-[clamp(24rem,30vw,32rem)]',
  md: 'max-w-[clamp(32rem,42vw,52rem)]',
  lg: 'max-w-[clamp(42rem,55vw,68rem)]',
};

export interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Render nothing when false. Defaults to true for conditionally-mounted modals. */
  open?: boolean;
  /**
   * Renders the standard header (title + close X) and wraps `children` in a
   * scrollable body. Omit to keep a bespoke header inside `children`.
   */
  title?: React.ReactNode;
  /** Rendered after the body, inside the panel. */
  footer?: React.ReactNode;
  /** Width preset for the panel (default 'md'). */
  size?: 'sm' | 'md' | 'lg';
  /** Tailwind max-width class(es) for the panel; overrides `size`. */
  maxWidth?: string;
  /** Close when the dim backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key (default true). */
  closeOnEscape?: boolean;
  /** Overlay layout + scrim classes (default: centered with a black/40 scrim). */
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
  /** Panel chrome classes (default: white rounded card). Width comes from size/maxWidth. */
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  ariaLabel?: string;
}

/**
 * Generic modal shell: fixed backdrop, centered panel, Escape + backdrop-click
 * dismissal. The body stays bespoke — pass `title` for the standard header or
 * render your own header inside `children`.
 */
export default function Modal({
  onClose,
  children,
  open = true,
  title,
  footer,
  size = 'md',
  maxWidth,
  closeOnBackdrop = true,
  closeOnEscape = true,
  overlayClassName = 'items-center justify-center p-4 bg-black/40',
  overlayStyle,
  panelClassName = 'bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]',
  panelStyle,
  ariaLabel,
}: ModalProps) {
  useEscapeKey(onClose, open && closeOnEscape);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex ${overlayClassName}`}
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className={`w-full ${maxWidth ?? SIZE_CLASSES[size]} ${panelClassName}`} style={panelStyle}>
        {title != null && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-base font-semibold text-brand-black">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-brand-grey hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {title != null ? <div className="overflow-y-auto flex-1">{children}</div> : children}
        {footer}
      </div>
    </div>
  );
}
