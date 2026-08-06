'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import Input from './Input';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/**
 * Confirmation modal for destructive or irreversible actions — replaces
 * `window.confirm` across the console. For the most dangerous actions
 * (deleting a community) pass `confirmText` to require the user to type it
 * before the confirm button unlocks.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  /** Require typing this exact text (e.g. the community name) to enable confirm. */
  confirmText?: string;
  /** Error message shown under the body (e.g. when the confirm action failed). */
  error?: React.ReactNode;
  /** Close when the dim backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key (default true). */
  closeOnEscape?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  destructive = false,
  confirmText,
  error,
  closeOnBackdrop = true,
  closeOnEscape = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(() => {
    if (open && !busy && closeOnEscape) onClose();
  });

  useEffect(() => {
    if (open) {
      setTyped('');
      setBusy(false);
      // Focus the type-to-confirm input once the dialog is in the DOM.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const locked = !!confirmText && typed.trim() !== confirmText;

  const handleConfirm = async () => {
    if (locked || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => closeOnBackdrop && !busy && onClose()}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-float">
        <h3 className="font-title text-lg font-medium text-text-primary">{title}</h3>
        {body && <div className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</div>}

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        {confirmText && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs text-text-muted">
              Type <span className="font-semibold text-text-primary">{confirmText}</span> to confirm
            </p>
            <Input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
              }}
              placeholder={confirmText}
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="pill-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'pill-danger' : 'pill-primary'}
            onClick={() => void handleConfirm()}
            disabled={locked}
            loading={busy}
            loadingText="Working…"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
