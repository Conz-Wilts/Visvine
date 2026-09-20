'use client';

import React, { useState, useEffect } from 'react';
import EditModal from './EditModal';
import ModalFooter from './ModalFooter';
import type { FullProfile } from '@/lib/types/profile';

interface Props {
  open: boolean;
  onClose: () => void;
  bio: string | null | undefined;
  onSave: (patch: Partial<FullProfile>) => Promise<void>;
}

export default function EditAboutModal({ open, onClose, bio, onSave }: Props) {
  const [value, setValue] = useState(bio ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setValue(bio ?? ''); }, [open, bio]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ bio: value.trim() || null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModal title="About" open={open} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <textarea
            aria-label="About"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={8}
            maxLength={2600}
            placeholder="About you"
            className="w-full min-h-[max(10rem,32vh)] px-3 py-2 border border-border-subtle rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-dark-green/30 resize-y"
          />
        </div>
        <ModalFooter onCancel={onClose} saving={saving} />
      </form>
    </EditModal>
  );
}
