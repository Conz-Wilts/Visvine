'use client';

import React from 'react';
import Modal from '@/components/ui/Modal';

interface EditModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/** Thin wrapper over the generic ui/Modal, kept for the profile edit dialogs. */
export default function EditModal({ title, open, onClose, children, size = 'md' }: EditModalProps) {
  return (
    <Modal title={title} open={open} onClose={onClose} size={size}>
      {children}
    </Modal>
  );
}
