'use client';

/**
 * The marketplace's notice channel: a stack of `Alert`s in the bottom-right.
 *
 * Installing, upgrading and publishing all answer with something the person who
 * pressed the button has to read — a refusal in the server's own words, a type
 * claim that became a tab, a version that is now in the review queue — and every
 * one of those happens after a dialog has closed. An inline banner would either
 * be attached to a row that just disappeared or push the list around; this keeps
 * the answer next to the cursor and out of the layout.
 *
 * Built on the existing `Alert` primitive rather than a new one: the four tones
 * and their dismiss affordance already exist, and a toast is that component in a
 * fixed position.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Alert } from '@/components/ui';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}

/** How long a toast stays before it retires itself. Errors never do — a refusal
 *  the reader missed is a refusal they will hit again. */
const DISMISS_AFTER_MS = 6000;

interface ToastApi {
  toasts: Toast[];
  push: (tone: ToastTone, message: ReactNode) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: ReactNode) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      if (tone === 'error') return;
      timers.current.push(
        window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_AFTER_MS),
      );
    },
    [],
  );

  // Timers outlive the component otherwise, and each one closes over setState.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((handle) => window.clearTimeout(handle));
  }, []);

  return { toasts, push, dismiss };
}

/**
 * Portalled to `document.body` for the same reason `Modal` is: the shell chrome
 * carries a transform, and `position: fixed` inside a transformed ancestor
 * resolves against that ancestor instead of the viewport.
 */
export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[min(26rem,calc(100vw-3rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto shadow-float">
          <Alert variant={toast.tone} onDismiss={() => onDismiss(toast.id)}>
            {toast.message}
          </Alert>
        </div>
      ))}
    </div>,
    document.body,
  );
}
