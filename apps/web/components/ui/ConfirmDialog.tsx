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
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(() => {
    if (open && !busy) onClose();
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
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-float">
        <h3 className="font-ginto text-lg font-medium text-text-primary">{title}</h3>
        {body && <div className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</div>}

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
