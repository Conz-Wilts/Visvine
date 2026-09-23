'use client';

/**
 * Toasts: a stack of Alerts in the bottom-right, for the answer to something a
 * person just pressed that arrives after the thing they pressed has gone — a
 * dialog that closed, a row that moved. An inline notice would be attached to
 * nothing, so it sits by the cursor instead, out of the layout.
 *
 *   const toasts = useToasts();
 *   toasts.push('success', 'Installed');
 *   <ToastHost toasts={toasts.toasts} onDismiss={toasts.dismiss} />
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Alert from './Alert';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}

/** How long a toast stays before it retires itself. Errors never do — a refusal
 *  the reader missed is a refusal they will hit again. */
const DISMISS_AFTER_MS = 6000;

export interface ToastApi {
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

  const push = useCallback((tone: ToastTone, message: ReactNode) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    if (tone === 'error') return;
    timers.current.push(
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_AFTER_MS),
    );
  }, []);

  // Timers outlive the component otherwise, and each one closes over setState.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((handle) => window.clearTimeout(handle));
  }, []);

  return { toasts, push, dismiss };
}

/**
 * Portalled to `document.body` for the same reason `Modal` is: shell chrome may
 * carry a transform, and `position: fixed` inside a transformed ancestor
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
        <div key={toast.id} className="pointer-events-auto bg-surface shadow-float">
          <Alert variant={toast.tone} onDismiss={() => onDismiss(toast.id)}>
            {toast.message}
          </Alert>
        </div>
      ))}
    </div>,
    document.body,
  );
}
