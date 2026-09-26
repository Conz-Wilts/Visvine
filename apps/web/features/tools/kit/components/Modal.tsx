'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal as AppModal } from '@visvine/ui';
import { useBridgeClientMaybe } from '../hooks';

export interface ModalProps {
  onClose: () => void;
  open?: boolean;
  title?: ReactNode;
  /** The buttons, right-aligned under the body. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/**
 * The app's Modal, laid out for a form: the body and footer carry the panel's
 * own gutter, so a Field inside it never runs to the edge. Open, it asks the
 * host to dim the app around the frame — a Tool's dialog is the whole page's,
 * never a grey box inside the frame.
 */
export function Modal({ onClose, open = true, title, footer, size = 'md', children }: ModalProps) {
  const client = useBridgeClientMaybe();
  useEffect(() => {
    if (!open || !client) return;
    void client.call('ui.scrim', { open: true }).catch(() => {});
    return () => {
      void client.call('ui.scrim', { open: false }).catch(() => {});
    };
  }, [open, client]);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={footer ? <div className="flex justify-end gap-2 border-t border-line-subtle px-6 py-4">{footer}</div> : undefined}
    >
      {title != null ? <div className="flex flex-col gap-4 px-6 py-5">{children}</div> : children}
    </AppModal>
  );
}
